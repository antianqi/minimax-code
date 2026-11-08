// The saved SSH hosts.
//
// This port keeps one store per concern and reports whether a probe verdict still belongs to the
// host it was probed against, because the WebUI's host list and its project list have to agree
// about which host a project is rooted on.
//
// The store holds no credential. A password is staged in memory for the first handshake and is
// never written here.
//
// Every change below is a transaction over the store file (see `storage.ts`): the record is read
// again under the file's lock, changed there, and committed. A save that started from a snapshot
// another save has since replaced therefore cannot overwrite it.
import path from "node:path";

import { SshRuntimeError } from "./errors.js";
import {
  createSshStore,
  storeUnavailableError,
  type SshStoreChange,
  type SshStoreRead,
} from "./storage.js";
import type { SshConnectionRecord, SshEndpointKind, SshEndpointRecord, SshStatus } from "./types.js";
import { isSafeSshAlias, isSafeSshHostname, isSafeSshPort, isSafeSshUser, isSafeAbsoluteLocalPath } from "./validators.js";

interface StoredConnection {
  readonly alias: string;
  readonly displayName: string;
  readonly endpoint: SshEndpointRecord;
  readonly enabled: boolean;
  readonly status: SshStatus;
  readonly lastError?: string;
}

const STATUSES: readonly SshStatus[] = [
  "idle",
  "connecting",
  "connected",
  "disconnected",
  "reconnecting",
  "failed",
  "probe_failed",
  "ready",
  "unknown",
  "disabled",
];

/**
 * What a probe's verdict could be committed to.
 *
 * `missing` and `changed` are answers, not failures: the probe saw a host that the store no
 * longer holds, and the honest action is to record nothing. `disabled` says the host was switched
 * off while the probe ran, so the verdict describes a host the user has already stopped using.
 */
export type SshProbeCommit =
  | { readonly outcome: "committed"; readonly record: SshConnectionRecord }
  | { readonly outcome: "missing" }
  | { readonly outcome: "changed" }
  | { readonly outcome: "disabled" };

export interface SshConnectionRepository {
  list(): Promise<readonly SshConnectionRecord[]>;
  get(alias: string): Promise<SshConnectionRecord | undefined>;
  getProbeTarget(alias: string): Promise<{ readonly record: SshConnectionRecord; readonly identityRevision: string } | undefined>;
  /** Create or replace one host. */
  save(record: {
    readonly alias: string;
    readonly displayName: string;
    readonly endpoint: SshEndpointRecord;
    readonly enabled: boolean;
    readonly status: SshStatus;
    readonly lastError?: string;
  }): Promise<SshConnectionRecord>;
  setEnabled(alias: string, enabled: boolean, status: SshStatus): Promise<SshConnectionRecord>;
  /**
   * Record a probe verdict, but only against the host the probe actually ran on.
   *
   * The endpoint the probe used is compared with the one the store holds at commit time, in the
   * same transaction as the write. The existing store revision also fences delete/recreate and
   * disable/enable transitions without adding a durable field; any intervening host-list write
   * conservatively invalidates the verdict. A probe that completes after the host was edited, disabled or
   * removed therefore cannot restore the old endpoint, re-enable the host, or recreate it.
   */
  commitProbe(input: {
    readonly alias: string;
    readonly probedEndpoint: SshEndpointRecord;
    readonly identityRevision: string;
    readonly status: SshStatus;
    readonly detail?: string;
  }): Promise<SshProbeCommit>;
  remove(alias: string): Promise<boolean>;
}

export function createSshConnectionRepository(filePath: string): SshConnectionRepository {
  const store = createSshStore<readonly StoredConnection[]>(filePath, {
    member: "connections",
    read: readStoredConnections,
  });

  /** The committed hosts, or the reason there are none to show. */
  const committed = async (): Promise<readonly StoredConnection[]> => {
    const read = await store.read();
    if (read.kind === "unusable") throw storeUnavailableError(filePath, read);
    return read.kind === "usable" ? read.value : [];
  };

  const current = (read: SshStoreRead<readonly StoredConnection[]>): readonly StoredConnection[] =>
    read.kind === "usable" ? read.value : [];

  return {
    async list() {
      return (await committed()).map(toRecord);
    },

    async get(alias) {
      const found = (await committed()).find((connection) => connection.alias === alias);
      return found ? toRecord(found) : undefined;
    },

    async getProbeTarget(alias) {
      const read = await store.read();
      if (read.kind === "unusable") throw storeUnavailableError(filePath, read);
      if (read.kind === "absent") return undefined;
      const found = read.value.find((connection) => connection.alias === alias);
      return found ? { record: toRecord(found), identityRevision: String(read.revision) } : undefined;
    },

    async save(record) {
      const stored: StoredConnection = {
        alias: record.alias,
        displayName: record.displayName,
        endpoint: record.endpoint,
        enabled: record.enabled,
        status: record.status,
        ...(record.lastError === undefined ? {} : { lastError: record.lastError }),
      };
      const { result } = await store.transact((read) => {
        const existing = current(read).find((connection) => connection.alias === record.alias);
        const merged = {
          ...existing,
          ...stored,
          lastError: stored.lastError,
          endpoint: { ...unknownEndpointFields(existing?.endpoint), ...stored.endpoint },
        };
        return {
          kind: "commit",
          value: [...current(read).filter((connection) => connection.alias !== record.alias), merged],
          result: toRecord(merged),
        };
      });
      return result;
    },

    async setEnabled(alias, enabled, status) {
      const { result } = await store.transact((read) => {
        const found = current(read).find((connection) => connection.alias === alias);
        if (!found) return { kind: "keep", result: undefined };
        const stored: StoredConnection = { ...found, enabled, status };
        return {
          kind: "commit",
          value: current(read).map((connection) =>
            connection.alias === alias ? stored : connection,
          ),
          result: toRecord(stored),
        };
      });
      if (!result) throw new SshRuntimeError("connection_not_found", "没有找到这个 SSH 主机。");
      return result;
    },

    async commitProbe(input) {
      const { result } = await store.transact(
        (read): SshStoreChange<readonly StoredConnection[], SshProbeCommit> => {
          const connections = current(read);
          const found = connections.find((connection) => connection.alias === input.alias);
          if (!found) return { kind: "keep", result: { outcome: "missing" } };
          if (!sameEndpoint(found.endpoint, input.probedEndpoint)) {
            return { kind: "keep", result: { outcome: "changed" } };
          }
          if (!found.enabled) return { kind: "keep", result: { outcome: "disabled" } };
          const identity = String(read.kind === "usable" ? read.revision : 0);
          if (identity !== input.identityRevision) return { kind: "keep", result: { outcome: "changed" } };
          const stored: StoredConnection = {
            ...found,
            status: input.status,
            lastError: input.detail,
          };
          return {
            kind: "commit",
            value: connections.map((connection) =>
              connection.alias === input.alias ? stored : connection,
            ),
            result: { outcome: "committed", record: toRecord(stored) },
          };
        },
      );
      return result;
    },

    async remove(alias) {
      const { result } = await store.transact((read) => {
        const connections = current(read);
        const remaining = connections.filter((connection) => connection.alias !== alias);
        if (remaining.length === connections.length) return { kind: "keep", result: false };
        return { kind: "commit", value: remaining, result: true };
      });
      return result;
    },
  };
}

/** The default location of the connection store under a runtime data directory. */
export function sshConnectionStorePath(dataDir: string): string {
  return path.join(dataDir, "ssh", "connections.json");
}

function toRecord(stored: StoredConnection): SshConnectionRecord {
  return {
    alias: stored.alias,
    displayName: stored.displayName,
    endpoint: knownEndpoint(stored.endpoint),
    enabled: stored.enabled,
    status: stored.status,
    ...(stored.lastError === undefined ? {} : { lastError: stored.lastError }),
  };
}

/** Two endpoints address the same host when every field they carry agrees. */
export function sameEndpoint(left: SshEndpointRecord, right: SshEndpointRecord): boolean {
  return (
    left.kind === right.kind &&
    left.host === right.host &&
    left.port === right.port &&
    left.username === right.username &&
    left.identityFile === right.identityFile &&
    left.alias === right.alias
  );
}

/**
 * The committed host records, validated field by field.
 *
 * The previous guard asked only for a string alias and a non-null endpoint object, so a record
 * missing its display name, its `enabled` flag or the endpoint's discriminator reached the
 * services as a fully typed host: `enabled` read `undefined` (falsy, so the host looked switched
 * off) and `endpoint.kind` named nothing. A record that does not hold every field is refused
 * with the field that failed, and the store is then reported unusable rather than silently
 * filtered — filtering is how a corrupt file turns into "you have no saved hosts".
 */
function readStoredConnections(
  value: unknown,
): { readonly ok: true; readonly value: readonly StoredConnection[] } | { readonly ok: false; readonly detail: string } {
  const connections: StoredConnection[] = [];
  for (const [index, entry] of (value as readonly unknown[]).entries()) {
    const connection = readStoredConnection(entry);
    if (typeof connection === "string") {
      return { ok: false, detail: `第 ${index + 1} 条主机记录${connection}` };
    }
    connections.push(connection);
  }
  return { ok: true, value: connections };
}

function readStoredConnection(value: unknown): StoredConnection | string {
  if (typeof value !== "object" || value === null) return "不是对象";
  const record = value as Record<string, unknown>;
  if (typeof record.alias !== "string" || !isSafeSshAlias(record.alias)) return "缺少有效 alias";
  if (typeof record.displayName !== "string") return `（${record.alias}）缺少 displayName`;
  if (typeof record.enabled !== "boolean") return `（${record.alias}）缺少 enabled`;
  if (typeof record.status !== "string" || !STATUSES.includes(record.status as SshStatus)) {
    return `（${record.alias}）的 status 不是已知状态`;
  }
  const endpoint = readStoredEndpoint(record.endpoint);
  if (typeof endpoint === "string") return `（${record.alias}）${endpoint}`;
  const lastError = record.lastError;
  if (lastError !== undefined && typeof lastError !== "string") {
    return `（${record.alias}）的 lastError 不是字符串`;
  }
  return {
    ...record,
    alias: record.alias,
    displayName: record.displayName,
    endpoint,
    enabled: record.enabled,
    status: record.status as SshStatus,
    ...(lastError === undefined ? {} : { lastError }),
  };
}

function readStoredEndpoint(value: unknown): SshEndpointRecord | string {
  if (typeof value !== "object" || value === null) return "缺少 endpoint";
  const endpoint = value as Record<string, unknown>;
  if (endpoint.kind === "ssh_config") {
    if (typeof endpoint.alias !== "string" || !isSafeSshAlias(endpoint.alias)) {
      return "的 endpoint 缺少 alias";
    }
  } else if (endpoint.kind === "manual") {
    if (typeof endpoint.host !== "string" || !isSafeSshHostname(endpoint.host)) {
      return "的 endpoint 缺少 host";
    }
  } else {
    return "的 endpoint 缺少已知的 kind";
  }
  if (endpoint.host !== undefined && (typeof endpoint.host !== "string" || !isSafeSshHostname(endpoint.host))) {
    return "的 endpoint.host 不是字符串";
  }
  if (endpoint.port !== undefined && (typeof endpoint.port !== "number" || !isSafeSshPort(endpoint.port))) {
    return "的 endpoint.port 不是数字";
  }
  if (endpoint.username !== undefined && (typeof endpoint.username !== "string" || !isSafeSshUser(endpoint.username))) {
    return "的 endpoint.username 不是字符串";
  }
  if (endpoint.identityFile !== undefined && (typeof endpoint.identityFile !== "string" || !isSafeAbsoluteLocalPath(endpoint.identityFile))) {
    return "的 endpoint.identityFile 不是字符串";
  }
  // 磁盘保留未知字段；返回调用者时由 knownEndpoint 单独投影。
  const host = typeof endpoint.host === "string" ? endpoint.host : undefined;
  const port = typeof endpoint.port === "number" ? endpoint.port : undefined;
  const username = typeof endpoint.username === "string" ? endpoint.username : undefined;
  const identityFile = typeof endpoint.identityFile === "string" ? endpoint.identityFile : undefined;
  const alias = typeof endpoint.alias === "string" ? endpoint.alias : undefined;
  return {
    ...endpoint,
    kind: endpoint.kind as SshEndpointKind,
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
    ...(username === undefined ? {} : { username }),
    ...(identityFile === undefined ? {} : { identityFile }),
    ...(alias === undefined ? {} : { alias }),
  };
}

const ENDPOINT_FIELDS = new Set(["kind", "host", "port", "username", "identityFile", "alias"]);

function unknownEndpointFields(endpoint: SshEndpointRecord | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(endpoint ?? {}).filter(([key]) => !ENDPOINT_FIELDS.has(key)));
}

function knownEndpoint(endpoint: SshEndpointRecord): SshEndpointRecord {
  return {
    kind: endpoint.kind,
    ...(endpoint.host === undefined ? {} : { host: endpoint.host }),
    ...(endpoint.port === undefined ? {} : { port: endpoint.port }),
    ...(endpoint.username === undefined ? {} : { username: endpoint.username }),
    ...(endpoint.identityFile === undefined ? {} : { identityFile: endpoint.identityFile }),
    ...(endpoint.alias === undefined ? {} : { alias: endpoint.alias }),
  };
}
