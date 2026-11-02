/**
 * The saved host's own state.
 *
 * Two claims, and both are about the host list telling the truth:
 *
 *   * **A probe is written back to the record.** A verdict the list cannot see is a verdict
 *     nobody was told; the stored record carries the answer, so a host that stopped answering
 *     stops looking connected.
 *   * **Switching a host on verifies it.** Enabling is a request to use the host, so the
 *     runtime answers whether it can be reached instead of leaving the row at "not connected".
 *
 * The transport is scripted, so nothing here opens a connection.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SSH_PROBE_MARKER } from "../../src/runtime/ssh/command.js";
import { createSshRuntime } from "../../src/runtime/ssh/index.js";
import type { SshDiscoveryDependencies } from "../../src/runtime/ssh/host-discovery.js";
import type { SshTransport } from "../../src/runtime/ssh/transport.js";

const directories: string[] = [];

function temporaryDataDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "webui-ssh-connection-"));
  directories.push(directory);
  return directory;
}

/** A transport whose answer can be changed while the test runs. */
function switchableTransport(): { readonly transport: SshTransport; readonly reachable: { value: boolean } } {
  const reachable = { value: true };
  return {
    reachable,
    transport: {
      run: async () =>
        reachable.value
          ? {
              stdout: `${SSH_PROBE_MARKER}\nhostname=example\nremote_user=root\n`,
              stderr: "",
              code: 0,
              timedOut: false,
            }
          : {
              stdout: "",
              stderr: "ssh: connect to host example.com port 22: Connection refused",
              code: 255,
              timedOut: false,
            },
      spawnTerminal: () => {
        throw new Error("no terminal in this test");
      },
    },
  };
}

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

/** A config file that declares one host, read without touching the machine's own. */
function syntheticDiscovery(alias: string): SshDiscoveryDependencies {
  return {
    readTextFile: async () => `Host ${alias}\n  HostName example.com\n  User builder\n`,
    listFiles: async () => [],
    runCommand: async () => ({ stdout: "", stderr: "" }),
    homeDirectory: () => "/home/tester",
  };
}

describe("the saved host's state", () => {
  it("writes the verdict of a probe back to the record", async () => {
    const { transport, reachable } = switchableTransport();
    const runtime = await createSshRuntime({ dataDir: temporaryDataDir(), transport });
    reachable.value = false;

    const saved = await runtime.connections.save({
      alias: "build",
      endpoint: { kind: "manual", host: "example.com" },
    });
    expect(saved.probe?.status).toBe("probe_failed");
    expect(saved.connection?.status).toBe("probe_failed");
    expect(saved.connection?.lastError).toContain("Connection refused");

    // The list reads the stored records, so the verdict has to be among them.
    const [stored] = await runtime.connections.list();
    expect(stored?.status).toBe("probe_failed");
    expect(stored?.lastError).toContain("Connection refused");

    reachable.value = true;
    const probed = await runtime.connections.probe("build");
    expect(probed.status).toBe("connected");
    const [verified] = await runtime.connections.list();
    expect(verified?.status).toBe("connected");
    expect(verified?.lastError).toBeUndefined();
  });

  it("verifies a host when it is switched on", async () => {
    const { transport, reachable } = switchableTransport();
    const runtime = await createSshRuntime({ dataDir: temporaryDataDir(), transport });
    reachable.value = false;

    await runtime.connections.save({
      alias: "build",
      endpoint: { kind: "manual", host: "example.com" },
    });
    const disabled = await runtime.connections.setEnabled("build", false);
    expect(disabled.connection?.status).toBe("disabled");

    reachable.value = true;
    const enabled = await runtime.connections.setEnabled("build", true);
    expect(enabled.probe?.status).toBe("connected");
    expect(enabled.connection?.status).toBe("connected");
    const [stored] = await runtime.connections.list();
    expect(stored?.status).toBe("connected");
  });

  it("refuses a host that the config file does not declare", async () => {
    const { transport } = switchableTransport();
    const runtime = await createSshRuntime({
      dataDir: temporaryDataDir(),
      transport,
      discovery: syntheticDiscovery("build"),
    });

    // The alias is declared: the host is saved and probed.
    const declared = await runtime.connections.save({
      alias: "build",
      endpoint: { kind: "ssh_config", alias: "build" },
    });
    expect(declared.success).toBe(true);

    // The alias is not: a host named in the config file cannot be reached by any other
    // route, so the runtime refuses it instead of leaving an unknown host name to fail.
    const undeclared = await runtime.connections.save({
      alias: "missing",
      endpoint: { kind: "ssh_config", alias: "missing" },
    });
    expect(undeclared.success).toBe(false);
    expect(undeclared.error).toBe("host_not_configured");
  });
});
