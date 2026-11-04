/**
 * The SSH panel's projection and its rendered branches.
 *
 * The claims are about what the panel says:
 *
 *   * the two Desktop empty states stay apart — "no host in `~/.ssh/config`" and "no host added
 *     and enabled yet" are different answers, and a panel that merges them sends the person to
 *     the wrong place;
 *   * a host's status word is printed as it is, so a host in `probe_failed` never reads as a
 *     working one;
 *   * the rendered branches are pinned through `renderToStaticMarkup` — this package has no jsdom.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  webuiSshDiscoveredHostRows,
  webuiSshDiscoveryEmptyText,
  webuiSshErrorMessage,
  webuiSshHostRows,
  webuiSshOverridePort,
  webuiSshOverrideValue,
  webuiSshPortInputError,
  webuiSshProjectRows,
  webuiSshStatusDotClass,
  webuiSshStatusLabel,
  WEBUI_SSH_CONFIG_UNREADABLE_TEXT,
  WEBUI_SSH_NO_CONFIG_TEXT,
  WEBUI_SSH_EMPTY_DESCRIPTION,
  WEBUI_SSH_EMPTY_TITLE,
  WEBUI_SSH_NO_HOSTS_TEXT,
} from "../../src/client/features/ssh/projection/ssh-panel.js";
import { SshPanelView, type SshPanelViewProps } from "../../src/client/features/ssh/ui/SshPanel.public.js";
import type {
  WebuiSshConnection,
  WebuiSshDiscovery,
  WebuiSshProject,
} from "../../src/shared/contracts/ssh.js";

function connection(overrides: Partial<WebuiSshConnection> = {}): WebuiSshConnection {
  return {
    alias: "build",
    displayName: "Build machine",
    endpoint: { kind: "manual", host: "example.com", port: 2222, username: "builder" },
    enabled: true,
    status: "connected",
    ...overrides,
  };
}

describe("the SSH projection", () => {
  it("keeps the two empty states apart", () => {
    expect(WEBUI_SSH_NO_HOSTS_TEXT).not.toBe(WEBUI_SSH_EMPTY_DESCRIPTION);
    expect(WEBUI_SSH_NO_HOSTS_TEXT).toContain("~/.ssh/config");
    expect(WEBUI_SSH_EMPTY_TITLE).toContain("SSH");
    expect(WEBUI_SSH_EMPTY_DESCRIPTION).toContain("远程服务器");
  });

  it("tells the three discovery outcomes apart", () => {
    const noConfig: WebuiSshDiscovery = { configFound: false, hosts: [] };
    const noHosts: WebuiSshDiscovery = { configFound: true, hosts: [] };
    const unreadable: WebuiSshDiscovery = { configFound: false, hosts: [], error: "config_unreadable" };
    const withHosts: WebuiSshDiscovery = {
      configFound: true,
      hosts: [{ alias: "build", hostname: "build.example.com" }],
    };

    expect(webuiSshDiscoveryEmptyText(noConfig)).toBe(WEBUI_SSH_NO_CONFIG_TEXT);
    expect(webuiSshDiscoveryEmptyText(noHosts)).toBe(WEBUI_SSH_NO_HOSTS_TEXT);
    expect(webuiSshDiscoveryEmptyText(unreadable)).toBe(WEBUI_SSH_CONFIG_UNREADABLE_TEXT);
    expect(webuiSshDiscoveryEmptyText(withHosts)).toBeUndefined();
  });

  it("colours the status dot by what the host answered", () => {
    // A host that is up wears the success glyph; a host that did not answer wears the error one;
    // a host that is off or still connecting stays neutral.
    expect(webuiSshStatusDotClass("connected", true)).toBe("bg-text_status_success");
    expect(webuiSshStatusDotClass("ready", true)).toBe("bg-text_status_success");
    expect(webuiSshStatusDotClass("probe_failed", true)).toBe("bg-text_status_error");
    expect(webuiSshStatusDotClass("connecting", true)).toBe("bg-icon_default_tertiary");
    expect(webuiSshStatusDotClass("disabled", false)).toBe("bg-icon_default_tertiary");
    expect(webuiSshStatusDotClass("connected", false)).toBe("bg-icon_default_tertiary");
  });

  it("keeps an override, drops it when the config value comes back, and asks for a new one", () => {
    // A host named in `~/.ssh/config` follows the config file unless a value is overridden on
    // purpose. This is Desktop's own rule for such a host.
    // Untouched, and the host follows the config: no override at all.
    expect(webuiSshOverrideValue("build.example.com", undefined, "build.example.com")).toBeUndefined();
    // Untouched, and the host carries an override: the override stays.
    expect(webuiSshOverrideValue("other.example.com", "other.example.com", "build.example.com")).toBe(
      "other.example.com",
    );
    // Set back to the config's own value: the override is dropped.
    expect(webuiSshOverrideValue("build.example.com", "other.example.com", "build.example.com")).toBe(
      undefined,
    );
    // A value the person chose: an override of their own.
    expect(webuiSshOverrideValue("third.example.com", "other.example.com", "build.example.com")).toBe(
      "third.example.com",
    );
    // Cleared: the host follows the config again.
    expect(webuiSshOverrideValue("", "other.example.com", "build.example.com")).toBeUndefined();
  });

  it("resolves a port the same way", () => {
    expect(webuiSshOverridePort("54751", undefined, 54751)).toBeUndefined();
    expect(webuiSshOverridePort("2222", 2222, 54751)).toBe(2222);
    expect(webuiSshOverridePort("54751", 2222, 54751)).toBeUndefined();
    expect(webuiSshOverridePort("22", 2222, 54751)).toBe(22);
    expect(webuiSshOverridePort("", 2222, 54751)).toBeUndefined();
  });

  it("refuses a port that cannot be read instead of dropping it", () => {
    // A port that is silently ignored is a connection that lands on a different port than
    // the one the person named.
    expect(webuiSshPortInputError("")).toBeUndefined();
    expect(webuiSshPortInputError("22")).toBeUndefined();
    expect(webuiSshPortInputError(" 54751 ")).toBeUndefined();
    expect(webuiSshPortInputError("not-a-port")).toContain("端口");
    expect(webuiSshPortInputError("0")).toContain("端口");
    expect(webuiSshPortInputError("70000")).toContain("端口");
  });

  it("prints the status word as it is", () => {
    expect(webuiSshStatusLabel("probe_failed")).toBe("探测失败");
    expect(webuiSshStatusLabel("connected")).toBe("已连接");
    expect(webuiSshStatusLabel("disabled")).toBe("已停用");
  });

  it("reads a host's endpoint in one line", () => {
    const [row] = webuiSshHostRows([connection()]);
    expect(row?.endpointLabel).toBe("builder@example.com:2222");
    expect(row?.statusLabel).toBe("已连接");
  });

  it("keeps the failure reason next to the host", () => {
    const [row] = webuiSshHostRows([
      connection({ status: "probe_failed", lastError: "连接被拒绝。" }),
    ]);
    expect(row?.statusLabel).toBe("探测失败");
    expect(row?.errorLabel).toBe("连接被拒绝。");
  });

  it("names a failure in one sentence", () => {
    expect(webuiSshErrorMessage("connection_not_found")).toContain("没有找到");
    expect(webuiSshErrorMessage("invalid_input")).toContain("不合法");
    expect(webuiSshErrorMessage("something-else")).toBeTruthy();
  });

  it("lists the discovered hosts and the projects", () => {
    const discovery: WebuiSshDiscovery = {
      configFound: true,
      hosts: [{ alias: "build", hostname: "build.example.com", user: "builder", port: 2222 }],
    };
    expect(webuiSshDiscoveredHostRows(discovery)).toEqual([
      { alias: "build", endpointLabel: "builder@build.example.com:2222" },
    ]);

    const projects: WebuiSshProject[] = [
      { id: "p1", alias: "build", path: "/srv/app", displayName: "app" },
    ];
    expect(webuiSshProjectRows(projects)).toEqual([
      { id: "p1", alias: "build", path: "/srv/app", displayName: "app" },
    ]);
  });
});

describe("the SSH panel", () => {
  // The view carries hooks now — its two failures are said through the toast — so it is
  // rendered as a component rather than called as a plain function: a hook outside a
  // render is an invalid hook call. The file is a `.ts` and the package has no JSX
  // transform for one.
  const view = (overrides: Partial<SshPanelViewProps> = {}): string =>
    renderToStaticMarkup(
      createElement(SshPanelView, {
        snapshot: { status: "ready", connections: [], projects: [] },
        terminal: { status: "closed", output: "" },
        onOpenAdd: () => undefined,
        onToggleHost: () => undefined,
        onOpenDetails: () => undefined,
        onCreateProject: () => undefined,
        onEditHost: () => undefined,
        onOpenTerminal: () => undefined,
        onCloseTerminal: () => undefined,
        onTerminalInput: () => undefined,
        onTerminalResize: () => undefined,
        onRemoveProject: () => undefined,
        onRequestRemove: () => undefined,
        ...overrides,
      }),
    );

  it("shows the Desktop's empty card when there is no host at all", () => {
    const markup = view();
    expect(markup).toContain(WEBUI_SSH_EMPTY_TITLE);
    expect(markup).toContain(WEBUI_SSH_EMPTY_DESCRIPTION);
    expect(markup).toContain("data-webui-ssh-empty");
    // The empty state offers the picker, and the list is not drawn.
    expect(markup).toContain("data-webui-ssh-add");
    expect(markup).not.toContain("data-webui-ssh-list");
  });

  it("does not show the empty state, and leaves the failed read to the toast", () => {
    const markup = view({
      snapshot: { status: "error", connections: [], projects: [], error: "读取 SSH 主机失败。" },
    });
    // A failed read is not an empty list: saying so would invite the person to add a
    // host they may already have.
    expect(markup).not.toContain("data-webui-ssh-empty");
    // The reason is an event, not a state: it is said once, through the shared toast,
    // which is drawn over the page (ADR 0030). A server render never sees it, so the
    // panel keeps no trace of it.
    expect(markup).not.toContain("读取 SSH 主机失败。");
    expect(markup).not.toContain('data-webui-ssh-error="true"');
    // The panel itself is still there.
    expect(markup).toContain('data-testid="ssh-connections-section"');
  });

  it("shows a host with its status, its switch and its actions", () => {
    const markup = view({
      snapshot: {
        status: "ready",
        connections: [connection({ status: "probe_failed", lastError: "连接被拒绝。" })],
        projects: [],
      },
    });
    expect(markup).toContain("Build machine");
    expect(markup).toContain("探测失败");
    expect(markup).toContain("连接被拒绝。");
    expect(markup).toContain("data-webui-ssh-toggle=\"build\"");
    // The Desktop's row carries a remote-project action and the row's own menu.
    expect(markup).toContain("data-webui-ssh-new-project=\"build\"");
    expect(markup).toContain("data-webui-ssh-more=\"build\"");
    expect(markup).toContain("查看 Build machine 的连接详情");
    expect(markup).toContain("启用或停用 build");
  });

  it("puts the hosts in one grouped card and offers the picker", () => {
    const markup = view({
      snapshot: {
        status: "ready",
        connections: [connection(), connection({ alias: "second", displayName: "Second" })],
        projects: [],
      },
    });
    expect(markup).toContain("data-webui-ssh-list");
    expect(markup).toContain("data-testid=\"ssh-connection-build\"");
    expect(markup).toContain("data-testid=\"ssh-connection-second\"");
    // The second row draws the separator the first one does not.
    expect(markup).toContain("border-t border-border_light");
  });

  it("mounts the terminal view for a live session and hands its output to xterm", () => {
    // The remote terminal is xterm inside the shared modal frame: xterm owns the
    // output, and the frame renders into a portal a server render does not have.
    // The panel owes the branch, the view owes the write.
    const panelSource = readFileSync(
      new URL("../../src/client/features/ssh/ui/SshPanel.public.tsx", import.meta.url),
      "utf8",
    );
    expect(panelSource).toContain('props.terminal.status === "closed"');
    expect(panelSource).toContain("<SshTerminalView");
    const terminalSource = readFileSync(
      new URL("../../src/client/features/ssh/ui/ssh-terminal-view.tsx", import.meta.url),
      "utf8",
    );
    expect(terminalSource).toContain("terminal.write(");
    expect(terminalSource).toContain("props.terminal.output");
    // A server render of the same snapshot reaches the panel's own chrome only.
    const markup = view({
      terminal: { status: "running", output: "hello from the remote shell", terminalId: "t1" },
    });
    expect(markup).toContain('data-testid="ssh-connections-section"');
  });
});

/* The two failures and the one confirmation the panel carries are said through
 * the shared toast (ADR 0030). The toast is raised in an effect and drawn over
 * the page, so a server render never sees it: the panel's own source is what
 * pins that the failures are reported at all, and not merely hidden. */
describe("the SSH panel reports its failures through the toast", () => {
  const source = readFileSync(
    new URL("../../src/client/features/ssh/ui/SshPanel.public.tsx", import.meta.url),
    "utf8",
  );

  it("raises the snapshot failure and the action failure through the toast", () => {
    expect(source).toContain("useWebuiToastError(");
    expect(source).toContain("props.snapshot.error");
    expect(source).toContain("props.error");
    expect(source).toContain("useWebuiToastSuccess(");
    // And the panel's own layout draws neither of them any more.
    expect(source).not.toContain("FeedbackError");
  });
});
