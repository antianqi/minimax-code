// The saved SSH hosts: add, update, switch on and off, remove, probe.
//
// The shape of this service: a save answers with the saved host *and* the probe that followed
// it, a removal answers with the projects that went with the host, and a host that cannot be
// reached is reported as such.
//
// Two rules shape the answers:
//
//   * **A host that cannot be reached says so.** A probe that fails is `probe_failed`, never a
//     `connected` that nobody verified.
//   * **A password is staged, never stored.** It arrives with the save request, it is kept in
//     memory for the handshake, and it never reaches the browser again.
import os from "node:os";

import { buildRemoteProbeCommand, buildSshArgs, SSH_PROBE_MARKER } from "./command.js";
import { isSshRuntimeError, SshRuntimeError } from "./errors.js";
import type { SshAuthentication } from "./authentication.js";
import type { SshCredentialStore } from "./credentials.js";
import type { SshConnectionRepository } from "./connection-repository.js";
import type { SshProjectRepository } from "./project-repository.js";
import type { SshTransport } from "./transport.js";
import type {
  SshConnectionRecord,
  SshDiscoveryRecord,
  SshEndpointRecord,
  SshProbeRecord,
} from "./types.js";
import {
  isSafeSshAlias,
  isSafeSshHostname,
  isSafeSshPort,
  isSafeSshUser,
  normalizeSshIdentityFile,
} from "./validators.js";

export interface SshSaveConnectionInput {
  readonly alias: string;
  readonly displayName?: string;
  readonly endpoint: SshEndpointRecord;
  readonly enabled?: boolean;
  /** A password to stage for the first handshake. It is never stored and never echoed back. */
  readonly password?: string;
}

export interface SshSaveConnectionOutcome {
  readonly success: boolean;
  readonly connection?: SshConnectionRecord;
  readonly probe?: SshProbeRecord;
  readonly error?: string;
}

export interface SshRemoveConnectionOutcome {
  readonly success: boolean;
  readonly removedProjectIds: readonly string[];
  readonly error?: string;
}

export interface SshConnectionService {
  list(): Promise<readonly SshConnectionRecord[]>;
  save(input: SshSaveConnectionInput): Promise<SshSaveConnectionOutcome>;
  setEnabled(alias: string, enabled: boolean): Promise<SshSaveConnectionOutcome>;
  remove(alias: string): Promise<SshRemoveConnectionOutcome>;
  probe(alias: string): Promise<SshProbeRecord>;
}

export interface SshConnectionServiceOptions {
  readonly repository: SshConnectionRepository;
  readonly projects: SshProjectRepository;
  readonly transport: SshTransport;
  readonly credentials: SshCredentialStore;
  /**
   * Which authentication each invocation uses, and whether a password can be delivered at all.
   *
   * Required: an optional helper is what let a caller pick the password-only option set with no
   * way to answer the prompt.
   */
  readonly authentication: SshAuthentication;
  /** The home directory a `~` in a key path is expanded against. */
  readonly homeDirectory?: () => string;
  /** The hosts `~/.ssh/config` declares, for the alias check. */
  readonly discoverHosts?: () => Promise<SshDiscoveryRecord>;
}

const PROBE_TIMEOUT_MS = 20_000;

export function createSshConnectionService(
  options: SshConnectionServiceOptions,
): SshConnectionService {
  /** The probes in flight, so two handshakes for one host do not overlap. */
  const probing = new Set<string>();
  const homeDirectory = options.homeDirectory ?? os.homedir;

  /**
   * Whether `~/.ssh/config` still declares this alias.
   *
   * A host named in the config file cannot be reached by any other route, so an alias the
   * config does not declare is refused rather than left to fail as an unknown host name.
   *
   * `unknown` means the config could not be read, or was never there: the runtime says
   * nothing about the alias then, and the handshake is left to answer.
   */
  const configAliasState = async (alias: string): Promise<"present" | "absent" | "unknown"> => {
    if (!options.discoverHosts) return "unknown";
    try {
      const discovery = await options.discoverHosts();
      if (!discovery.configFound || discovery.error !== undefined) return "unknown";
      return discovery.hosts.some((host) => host.alias === alias) ? "present" : "absent";
    } catch {
      return "unknown";
    }
  };

  const probe = async (connection: SshConnectionRecord): Promise<SshProbeRecord> => {
    // One decision, three callers: this module says whether the staged password can be
    // delivered at all. A password that cannot be delivered does not become a password-only
    // invocation — that reached OpenSSH with key authentication turned off and no answer to the
    // prompt, and the person read a generic handshake failure.
    const mode = options.authentication.modeFor(connection.alias);
    if (mode.kind === "unavailable") {
      return { alias: connection.alias, status: "probe_failed", detail: `密码登录不可用：${mode.reason}` };
    }
    const args = buildSshArgs(connection.endpoint, { password: mode.kind === "password" });
    const env = mode.kind === "password" ? mode.env : undefined;
    const redaction = options.credentials.captureRedaction(connection.alias);
    try {
      const result = await options.transport.run(
        [...args, buildRemoteProbeCommand()],
        env ? { env, timeoutMs: PROBE_TIMEOUT_MS } : { timeoutMs: PROBE_TIMEOUT_MS },
      );
      return readProbeResult(connection.alias, result.stdout, result.stderr, result, redaction.redact);
    } finally { redaction.dispose(); }
  };

  const runProbe = async (alias: string): Promise<SshProbeRecord> => {
    // The slot is claimed before the first await.
    //
    // It used to be claimed after reading the host, so two probes that started together both
    // read it, both passed the guard and both ran — and the slower verdict overwrote the faster
    // one. Claiming first is what makes "one probe per host" true for the whole read-probe-commit
    // span rather than only for its middle.
    if (probing.has(alias)) {
      return { alias, status: "failed", detail: "这个主机的探测正在进行中。" };
    }
    probing.add(alias);
    try {
      const target = await options.repository.getProbeTarget(alias);
      const connection = target?.record;
      if (!connection) {
        return { alias, status: "failed", detail: "没有找到这个 SSH 主机。" };
      }
      if (!connection.enabled) {
        return { alias, status: "disabled", detail: "这个主机已停用。" };
      }
      if (connection.endpoint.kind === "ssh_config" && (await configAliasState(alias)) === "absent") {
        return { alias, status: "probe_failed", detail: "这个主机不在 ~/.ssh/config 里。" };
      }
      const probed = await probe(connection);
      // The verdict is written back to the record: a probe the host list cannot see is a
      // probe that never happened. The write is fenced on the endpoint the probe ran against,
      // so a disable, an endpoint edit or a removal made while it ran keeps its own answer —
      // the probe cannot re-enable the host, restore the old endpoint, or recreate the record.
      const committed = await options.repository.commitProbe({
        alias: connection.alias,
        identityRevision: target!.identityRevision,
        probedEndpoint: connection.endpoint,
        status: probed.status,
        ...(probed.status === "connected" || probed.detail === undefined
          ? {}
          : { detail: probed.detail }),
      });
      if (committed.outcome !== "committed") {
        return {
          alias,
          status: committed.outcome === "disabled" ? "disabled" : "failed",
          detail: committed.outcome === "missing" ? "没有找到这个 SSH 主机。" : "主机列表已更改，探测结果已过期。",
        };
      }
      return probed;
    } finally {
      probing.delete(alias);
    }
  };

  return {
    list: () => options.repository.list(),

    async save(input) {
      const alias = input.alias?.trim() ?? "";
      if (!isSafeSshAlias(alias)) {
        return { success: false, error: "invalid_input" };
      }
      const endpoint = readEndpoint(input.endpoint, homeDirectory());
      if (!endpoint) return { success: false, error: "invalid_input" };
      if (endpoint.kind === "ssh_config" && (await configAliasState(alias)) === "absent") {
        return { success: false, error: "host_not_configured" };
      }
      if (input.password !== undefined) {
        // A password this host cannot deliver is refused where it arrives, not reported as saved
        // and left to fail later as a handshake nobody can explain.
        if (!options.authentication.availability.available) {
          throw new SshRuntimeError("credential_unavailable", options.authentication.availability.reason);
        }
        try {
          options.credentials.stage(alias, input.password);
        } catch {
          return { success: false, error: "credential_unavailable" };
        }
      }

      const existing = await options.repository.get(alias);
      const enabled = input.enabled ?? existing?.enabled ?? true;
      const displayName = input.displayName?.trim() || existing?.displayName || alias;
      await options.repository.save({
        alias,
        displayName,
        endpoint,
        enabled,
        status: enabled ? "idle" : "disabled",
      });

      const probed = await runProbe(alias);
      // The stored record carries the probe's verdict, so the host list and the probe answer
      // agree: a host that could not be reached is listed as `probe_failed`, not as saved-and-fine.
      const connection = await options.repository.get(alias);
      if (!connection) return { success: false, error: "connection_not_found", probe: probed };
      return { success: true, connection, probe: probed };
    },

    async setEnabled(alias, enabled) {
      if (!isSafeSshAlias(alias)) return { success: false, error: "invalid_input" };
      const connection = await options.repository.get(alias);
      if (!connection) return { success: false, error: "connection_not_found" };
      // The removal may land between the read above and this write; the transaction then has no
      // record to change, and the caller is told the host is gone rather than shown a saved
      // record that was never written.
      const saved = await options.repository
        .setEnabled(alias, enabled, enabled ? "idle" : "disabled")
        .catch((error: unknown) => {
          if (isSshRuntimeError(error) && error.code === "connection_not_found") {
            return undefined;
          }
          throw error;
        });
      if (!saved) return { success: false, error: "connection_not_found" };
      if (!enabled) return { success: true, connection: saved };
      // Enabling a host is a request to use it, so the runtime answers whether it can be
      // reached. The probe is that connection, and the list shows what it answered.
      const probed = await runProbe(alias);
      const verified = await options.repository.get(alias);
      if (!verified) return { success: false, error: "connection_not_found", probe: probed };
      return { success: true, connection: verified, probe: probed };
    },

    async remove(alias) {
      if (!isSafeSshAlias(alias)) return { success: false, removedProjectIds: [], error: "invalid_input" };
      const connection = await options.repository.get(alias);
      if (!connection) return { success: false, removedProjectIds: [], error: "connection_not_found" };
      const removedProjectIds = await options.projects.removeByHost(alias);
      await options.repository.remove(alias);
      options.credentials.remove(alias);
      return { success: true, removedProjectIds };
    },

    probe: runProbe,
  };
}

/**
 * The endpoint a save request carries, when it is one this runtime accepts.
 *
 * A key path is expanded here, so a request may name it the way OpenSSH itself writes it
 * (`~/.ssh/id_ed25519`) and the record holds the absolute path afterwards.
 *
 * For a host named in `~/.ssh/config` the alias is enough: OpenSSH resolves the host, the
 * user, the port and the key from the config file when it is asked for that alias. The
 * overrides a request carries are the ones the person changed on purpose, and nothing else
 * is stored.
 */
function readEndpoint(
  value: SshEndpointRecord | undefined,
  homeDirectory: string,
): SshEndpointRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (value.kind === "ssh_config") {
    const alias = value.alias?.trim();
    if (!alias || !isSafeSshAlias(alias)) return undefined;
    if (value.host !== undefined && !isSafeSshHostname(value.host)) return undefined;
    if (value.port !== undefined && !isSafeSshPort(value.port)) return undefined;
    if (value.username !== undefined && !isSafeSshUser(value.username)) return undefined;
    const identityFile =
      value.identityFile === undefined
        ? undefined
        : normalizeSshIdentityFile(value.identityFile, homeDirectory);
    if (value.identityFile !== undefined && identityFile === undefined) return undefined;
    return {
      kind: "ssh_config",
      alias,
      ...(value.host === undefined ? {} : { host: value.host }),
      ...(value.port === undefined ? {} : { port: value.port }),
      ...(value.username === undefined ? {} : { username: value.username }),
      ...(identityFile === undefined ? {} : { identityFile }),
    };
  }
  if (value.kind !== "manual") return undefined;
  const host = value.host?.trim();
  if (!host || !isSafeSshHostname(host)) return undefined;
  if (value.username !== undefined && !isSafeSshUser(value.username)) return undefined;
  if (value.port !== undefined && !isSafeSshPort(value.port)) return undefined;
  const identityFile =
    value.identityFile === undefined
      ? undefined
      : normalizeSshIdentityFile(value.identityFile, homeDirectory);
  if (value.identityFile !== undefined && identityFile === undefined) return undefined;
  return {
    kind: "manual",
    host,
    ...(value.port === undefined ? {} : { port: value.port }),
    ...(value.username === undefined ? {} : { username: value.username }),
    ...(identityFile === undefined ? {} : { identityFile }),
  };
}

/**
 * What one probe answered.
 *
 * A failed probe keeps the reason, so the host list can say *why* the host is not usable instead
 * of showing a bare status. The reason is a short sentence: OpenSSH's own output can be several
 * lines, and the browser is not a log viewer.
 */
function readProbeResult(
  alias: string,
  stdout: string,
  stderr: string,
  result: { readonly code: number | null; readonly timedOut: boolean; readonly spawnError?: NodeJS.ErrnoException },
  redact: (value: string) => string,
): SshProbeRecord {
  if (result.spawnError) {
    if (result.spawnError.code === "ENOENT") {
      return { alias, status: "probe_failed", detail: "系统里没有找到 ssh 命令。" };
    }
    return {
      alias,
      status: "probe_failed",
      detail: redact(`无法启动 ssh：${result.spawnError.message}`),
    };
  }
  if (result.timedOut) {
    return { alias, status: "probe_failed", detail: "连接超时，主机没有在期限内回应。" };
  }
  const markerIndex = stdout.indexOf(SSH_PROBE_MARKER);
  if (markerIndex < 0) {
    const reason = firstLine(redact(stderr)) || firstLine(redact(stdout));
    return {
      alias,
      status: "probe_failed",
      detail: redact(reason ? `主机没有完成握手：${reason}` : "主机没有完成握手。"),
    };
  }
  const values = new Map<string, string>();
  for (const line of stdout.slice(markerIndex + SSH_PROBE_MARKER.length).split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    if (!values.has(key)) values.set(key, line.slice(separator + 1).trim());
  }
  const hostname = values.get("hostname");
  const user = values.get("remote_user");
  const where = [hostname, user].filter((value) => Boolean(value)).join("@");
  return {
    alias,
    status: "connected",
    ...(where ? { detail: `已连接：${where}` } : { detail: "已连接。" }),
  };
}

/** The first non-empty line of a captured output, trimmed to a readable length. */
function firstLine(value: string): string {
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }
  return "";
}
