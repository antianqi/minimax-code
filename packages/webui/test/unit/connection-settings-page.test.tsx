/**
 * The connection settings page.
 *
 * The claims are about the page's shape:
 *
 *   * the page carries the two supported tabs, and the first one is the one that opens;
 *   * the removed controlled-devices tab and card are absent;
 *   * the SSH half mounts the SSH panel.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectionSettingsPage } from "../../src/client/features/settings/ui/ConnectionSettingsPage.js";
import { WebuiSshOwnerProvider } from "../../src/client/bindings/ssh-owner-context.js";
import { WebuiRemoteControlOwnerProvider } from "../../src/client/bindings/remote-control-owner-context.js";
import type { WebuiRemoteControlOwner } from "../../src/client/features/remote-control/application/remote-control-owner.js";
import type { WebuiSshOwner } from "../../src/client/features/ssh/application/ssh-owner.js";

function owner(): WebuiSshOwner {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => ({ status: "ready", connections: [], projects: [] }),
    getTerminalSnapshot: () => ({ status: "closed", output: "" }),
    load: async () => undefined,
    loadDiscovery: async () => undefined,
    saveConnection: async () => ({ ok: true }),
    setEnabled: async () => ({ ok: true }),
    removeConnection: async () => ({ ok: true }),
    probeConnection: async () => ({ ok: true }),
    saveProject: async () => ({ ok: true }),
    removeProject: async () => ({ ok: true }),
    listDirectories: async () => ({ ok: true, path: "", entries: [] }),
    openTerminal: async () => ({ ok: true }),
    writeTerminal: async () => false,
    resizeTerminal: async () => false,
    closeTerminal: async () => undefined,
    watchTerminal: () => () => undefined,
  };
}

function remoteControlOwner(): WebuiRemoteControlOwner {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => ({ status: "idle" }),
    load: async () => undefined,
    startWatching: () => () => undefined,
    connect: async () => ({ ok: false, message: "not wired" }),
    disconnect: async () => ({ ok: false, message: "not wired" }),
    resolveUnbind: async () => ({ ok: false, message: "not wired" }),
  };
}

describe("the connection settings page", () => {
  it("carries the supported tabs", () => {
    const markup = renderToStaticMarkup(
      <WebuiRemoteControlOwnerProvider owner={remoteControlOwner()}>
        <ConnectionSettingsPage />
      </WebuiRemoteControlOwnerProvider>,
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain("控制这台电脑");
    expect(markup).not.toContain("控制其他设备");
    expect(markup).toContain("SSH");
    // The first tab is the one that opens.
    expect(markup).toContain('aria-selected="true"');
  });

  it("does not render the removed controlled-devices panel", () => {
    const markup = renderToStaticMarkup(
      <WebuiRemoteControlOwnerProvider owner={remoteControlOwner()}>
        <ConnectionSettingsPage />
      </WebuiRemoteControlOwnerProvider>,
    );
    expect(markup).not.toContain("connection-controlled-devices");
  });

  it("mounts the SSH panel in the SSH half", () => {
    const markup = renderToStaticMarkup(
      <WebuiSshOwnerProvider owner={owner()}>
        <WebuiRemoteControlOwnerProvider owner={remoteControlOwner()}>
          <ConnectionSettingsPage initialSection="ssh" />
        </WebuiRemoteControlOwnerProvider>
      </WebuiSshOwnerProvider>,
    );
    expect(markup).toContain('data-testid="ssh-connections-section"');
    expect(markup).toContain("通过 SSH 连接远程服务器");
  });
});
