/**
 * The 接入 IM pane: projection, owner transitions, and the rendered branches.
 *
 * The claims are asserted where they are made rather than through a browser: which rows exist and
 * what state each one carries, the empty state, the refusal a host without an IM channel service
 * gets, the create flow's prepare-then-authorize order, the two card shapes, and the sections the
 * runtime has no route behind. Rendering goes through `renderToStaticMarkup` — this package has no
 * jsdom.
 *
 * The list is Desktop's bot list, not its bound-client list: a bot whose QR scan has not finished
 * belongs in it, in the unbound shape. That distinction is what the first block pins.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  createWebuiChannelOwner,
  WEBUI_CHANNEL_UNAVAILABLE,
  type WebuiChannelSnapshot,
} from "../../src/client/features/channel/application/channel-owner.js";
import type { ChannelPort } from "../../src/client/features/channel/contracts/channel-port.js";
import {
  WEBUI_CHANNEL_EMPTY_TEXT,
  WEBUI_CHANNEL_NOT_WIRED,
  WEBUI_CHANNEL_SECTION_DELETE,
  WEBUI_CHANNEL_SECTION_WORKSPACE,
  webuiChannelAssociationLabel,
  webuiChannelConfigLabel,
  webuiChannelFilterKey,
  webuiChannelPlatformLabel,
  webuiChannelProjectLabel,
  webuiChannelRows,
  webuiChannelStateLabel,
} from "../../src/client/features/channel/projection/channel-panel.js";
import { ChannelConnectPanelView } from "../../src/client/features/channel/ui/ChannelConnectPanel.public.js";
import type {
  WebuiChannelConnection,
  WebuiChannelConnectionState,
} from "../../src/shared/contracts/channel.js";

function connection(overrides: Partial<WebuiChannelConnection> = {}): WebuiChannelConnection {
  return {
    connectionId: "connection_feishu",
    channel: "feishu",
    agentName: "mavis",
    projectKey: null,
    state: "bound",
    ...overrides,
  };
}

/** A bound WeChat bot, as the runtime reports one after a scan. */
function boundWechat(overrides: Partial<WebuiChannelConnection> = {}): WebuiChannelConnection {
  return connection({
    connectionId: "connection_wechat",
    channel: "wechat",
    state: "bound",
    binding: {
      bindingId: "binding_1",
      externalId: "wechat:mavis",
      currentSessionId: "mvs_1",
    },
    ...overrides,
  });
}

function snapshot(overrides: Partial<WebuiChannelSnapshot> = {}): WebuiChannelSnapshot {
  return { status: "ready", connections: [], ...overrides };
}

const noop = (): void => {};

describe("B16 filter write publication", () => {
  it.each(["selection", "new write", "failure", "dispose"])("settles the old write without overwriting %s", async (action) => {
    let resolve!: (value: { mode: "full"; includeToolSummary: boolean }) => void;
    let reject!: (error: unknown) => void;
    const old = new Promise<{ mode: "full"; includeToolSummary: boolean }>((res, rej) => { resolve = res; reject = rej; });
    let calls = 0;
    const owner = createWebuiChannelOwner({ port: {
      listChannelConnections: async () => ({ connections: [boundWechat({ connectionId: "A" }), boundWechat({ connectionId: "B" })] }),
      getChannelMessageFilter: async () => ({ mode: "result", includeToolSummary: false }),
      updateChannelMessageFilter: () => ++calls === 1 ? old : Promise.resolve({ mode: "result", includeToolSummary: false }),
    } });
    await owner.load(); await owner.select("A");
    const pending = owner.updateMessageFilter({ agent: "wechat:mavis", filter: { mode: "full", includeToolSummary: true } });
    if (action === "new write") await owner.updateMessageFilter({ agent: "wechat:mavis", filter: { mode: "result", includeToolSummary: false } });
    else if (action === "dispose") owner.dispose();
    else await owner.select("B");
    const before = owner.getSnapshot();
    if (action === "failure") reject(new Error("A failed")); else resolve({ mode: "full", includeToolSummary: true });
    expect((await pending).ok).toBe(action !== "failure");
    expect(owner.getSnapshot()).toBe(before);
    owner.dispose();
  });
});

/** The pane's own source: the toast is raised in an effect, so only the source pins it. */
const panelSource = readFileSync(
  fileURLToPath(
    new URL("../../src/client/features/channel/ui/ChannelConnectPanel.public.tsx", import.meta.url),
  ),
  "utf8",
);

function view(snap: WebuiChannelSnapshot, menuOpen = false): string {
  // The view carries hooks now — its two failures are said through the toast —
  // so it is rendered as a component rather than called as a plain function: a
  // hook outside a render is an invalid hook call. The file is a `.ts` and the
  // package has no JSX transform for one.
  return renderToStaticMarkup(
    createElement(ChannelConnectPanelView, {
      snapshot: snap,
      menuOpen: menuOpen,
      deleting: false,
      onSelect: noop,
      onAdd: noop,
      onRefreshAuthorization: noop,
      onUnbind: noop,
      onDelete: noop,
      onBind: noop,
      onUpdateFilter: noop,
      onMenuOpenChange: noop,
      onOpenDelete: noop,
      onCloseDelete: noop,
    }),
  );
}

describe("the 接入 IM projection", () => {
  it("names the platforms Desktop names and prints an unknown one as it came", () => {
    expect(webuiChannelPlatformLabel("wechat")).toBe("微信");
    expect(webuiChannelPlatformLabel("feishu")).toBe("飞书");
    expect(webuiChannelPlatformLabel("telegram")).toBe("Telegram");
    expect(webuiChannelPlatformLabel("slack")).toBe("slack");
  });

  it("names the association after the platform the bot is bound to", () => {
    expect(webuiChannelAssociationLabel("wechat")).toBe("已关联微信，可解除或新建 bot");
    expect(webuiChannelAssociationLabel("feishu")).toBe("已关联飞书，可解除或新建 bot");
    expect(webuiChannelAssociationLabel("telegram")).toBe("已关联 Telegram，可解除或新建 bot");
  });

  it("reads every unbound state as 未绑定 and only bound as 已绑定", () => {
    expect(webuiChannelStateLabel("bound")).toBe("已绑定");
    for (const state of ["configured", "authorizing", "error"] as WebuiChannelConnectionState[]) {
      expect(webuiChannelStateLabel(state)).toBe("未绑定");
    }
  });

  it("keys every row by its connection and takes bound from the bot's own state", () => {
    const rows = webuiChannelRows(
      [boundWechat(), connection({ connectionId: "connection_new", state: "configured" })],
      "connection_wechat",
    );

    expect(rows).toEqual([
      {
        connectionId: "connection_wechat",
        platform: "wechat",
        platformLabel: "微信",
        agentLabel: "mavis",
        selected: true,
        botName: "ClawBot",
        bound: true,
        stateLabel: "已绑定",
      },
      {
        connectionId: "connection_new",
        platform: "feishu",
        platformLabel: "飞书",
        agentLabel: "mavis",
        selected: false,
        botName: "新 Bot",
        bound: false,
        stateLabel: "未绑定",
      },
    ]);
  });

  it("draws a bot whose QR scan has not finished as unbound, even while it is authorizing", () => {
    // The reported failure: a pending authorization used to be listed as 已绑定.
    const [row] = webuiChannelRows([
      connection({ connectionId: "connection_pending", channel: "wechat", state: "authorizing" }),
    ]);

    expect(row.bound).toBe(false);
    expect(row.stateLabel).toBe("未绑定");
    expect(row.botName).toBe("ClawBot");
  });

  it("orders the rows the way Desktop's platform catalogue does, not by creation time", () => {
    const rows = webuiChannelRows([
      connection({ connectionId: "connection_feishu", channel: "feishu" }),
      connection({ connectionId: "connection_wechat", channel: "wechat", state: "configured" }),
      connection({ connectionId: "connection_telegram", channel: "telegram", state: "configured" }),
    ]);

    // Desktop groups the list by platform in its catalogue order (微信, 飞书, Telegram), so the
    // first row — the one the card opens on — is the WeChat bot whatever order the store returns.
    expect(rows.map((row) => row.platform)).toEqual(["wechat", "feishu", "telegram"]);
  });

  it("names a non-WeChat bot by its binding's label, then its transport identity", () => {
    expect(
      webuiChannelRows([
        connection({
          connectionId: "connection_labelled",
          state: "bound",
          binding: { bindingId: "b1", externalId: "mavis", label: "团队飞书机器人" },
        }),
      ])[0].botName,
    ).toBe("团队飞书机器人");
    expect(
      webuiChannelRows([
        connection({
          connectionId: "connection_plain",
          state: "bound",
          binding: { bindingId: "b1", externalId: "mavis" },
        }),
      ])[0].botName,
    ).toBe("mavis");
  });

  it("shows the working directory the runtime stored, and 未选项目 when it holds none", () => {
    expect(webuiChannelProjectLabel(null)).toBe("未选项目");
    expect(webuiChannelProjectLabel("")).toBe("未选项目");
    expect(webuiChannelProjectLabel("default")).toBe("default");
  });

  it("keys the message filter by the bot's transport identity, and by nothing until it is bound", () => {
    expect(webuiChannelFilterKey(boundWechat())).toBe("wechat:mavis");
    expect(webuiChannelFilterKey(connection({ state: "configured" }))).toBeUndefined();
  });

  it("carries the runtime's failure code on the row that has one", () => {
    const [row] = webuiChannelRows([
      connection({ connectionId: "connection_failed", state: "error", errorCode: "WECHAT_QR_EXPIRED" }),
    ]);

    expect(row.bound).toBe(false);
    expect(row.errorCode).toBe("WECHAT_QR_EXPIRED");
  });
});

describe("the 接入 IM owner", () => {
  it("refuses once when the transport carries no IM bot list", async () => {
    const owner = createWebuiChannelOwner({ port: {} });

    await owner.load();

    expect(owner.getSnapshot().status).toBe("error");
    expect(owner.getSnapshot().error).toBe(WEBUI_CHANNEL_UNAVAILABLE);
    // A refusal is not an empty list: the pane must not read as "no IM bot exists".
    expect(owner.getSnapshot().connections).toEqual([]);
  });

  it("keeps the last good bots on screen when the next read fails", async () => {
    let fail = false;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => {
          if (fail) throw new Error("the channel service went away");
          return { connections: [boundWechat()] };
        },
      },
    });

    await owner.load();
    expect(owner.getSnapshot().status).toBe("ready");
    expect(owner.getSnapshot().connections).toEqual([boundWechat()]);

    fail = true;
    await owner.load();
    expect(owner.getSnapshot().status).toBe("error");
    expect(owner.getSnapshot().error).toBe("the channel service went away");
    expect(owner.getSnapshot().connections).toEqual([boundWechat()]);
  });

  it("reads the agent's configuration and the bot's own message filter on selection", async () => {
    const configAgents: string[] = [];
    const filterKeys: string[] = [];
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({ connections: [boundWechat()] }),
        checkChannelConfig: async (request) => {
          configAgents.push(request.agent);
          return { configured: true };
        },
        getChannelMessageFilter: async (request) => {
          filterKeys.push(request.agent);
          return { mode: "full", includeToolSummary: true };
        },
      },
    });

    await owner.load();
    await owner.select("connection_wechat");

    // The configuration belongs to the agent; the filter belongs to the transport client.
    expect(configAgents).toEqual(["mavis"]);
    expect(filterKeys).toEqual(["wechat:mavis"]);
    expect(owner.getSnapshot().config).toEqual({ configured: true });
    expect(owner.getSnapshot().filter).toEqual({ mode: "full", includeToolSummary: true });
  });

  it("creates the bot first, then starts its authorization for that same bot", async () => {
    const started: { name: string; connectionId?: string }[] = [];
    let prepared = false;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({
          connections: prepared
            ? [connection({ connectionId: "connection_new", channel: "wechat", state: "authorizing" })]
            : [],
        }),
        prepareChannelConnection: async (request) => {
          expect(request.platform).toBe("wechat");
          prepared = true;
          return { success: true };
        },
        startChannelWechatBind: async (request) => {
          started.push({ name: request.name, ...(request.connectionId === undefined ? {} : { connectionId: request.connectionId }) });
          return { ok: true, sessionId: "sess-1", qrContent: "https://liteapp.weixin.qq.com/q/x" };
        },
      },
    });

    const result = await owner.addBot("wechat");

    expect(result).toEqual({ ok: true });
    // Desktop creates the bot and authorizes it second, so the authorization belongs to the bot
    // that was just prepared rather than to the agent's default one.
    expect(started).toEqual([{ name: "ClawBot", connectionId: "connection_new" }]);
    expect(owner.getSnapshot().selectedId).toBe("connection_new");
    expect(owner.getSnapshot().authorization).toEqual({
      connectionId: "connection_new",
      platform: "wechat",
      status: "pending",
      sessionId: "sess-1",
      qrContent: "https://liteapp.weixin.qq.com/q/x",
    });
  });

  it("creates a Feishu bot without starting a QR authorization", async () => {
    let prepared = false;
    let started = 0;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({
          connections: prepared
            ? [connection({ connectionId: "connection_feishu_new", state: "configured" })]
            : [],
        }),
        prepareChannelConnection: async () => {
          prepared = true;
          return { success: true };
        },
        startChannelWechatBind: async () => {
          started += 1;
          return { ok: true, sessionId: "unused" };
        },
      },
    });

    const result = await owner.addBot("feishu");

    expect(result).toEqual({ ok: true });
    // This runtime serves Feishu through its credential bind, so the card asks for the app id and
    // secret instead of showing a QR.
    expect(started).toBe(0);
    expect(owner.getSnapshot().selectedId).toBe("connection_feishu_new");
    expect(owner.getSnapshot().authorization).toBeUndefined();
  });

  it("reports a refused bot creation as a value, and prepares nothing else", async () => {
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({ connections: [] }),
        prepareChannelConnection: async () => ({
          success: false,
          error: "CHANNEL_CONNECTIONS_UNAVAILABLE: no connection store",
        }),
      },
    });

    const result = await owner.addBot("wechat");

    expect(result).toEqual({
      ok: false,
      message: "CHANNEL_CONNECTIONS_UNAVAILABLE: no connection store",
    });
    expect(owner.getSnapshot().actionError).toBe(
      "CHANNEL_CONNECTIONS_UNAVAILABLE: no connection store",
    );
  });

  it("starts the authorization of an unbound bot as soon as its card is shown", async () => {
    const started: string[] = [];
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({
          connections: [
            connection({ connectionId: "connection_pending", channel: "wechat", state: "configured" }),
          ],
        }),
        startChannelWechatBind: async (request) => {
          started.push(request.connectionId ?? "");
          return { ok: true, sessionId: "sess-2", qrContent: "https://liteapp.weixin.qq.com/q/y" };
        },
      },
    });

    await owner.load();
    const release = owner.startRefreshing();
    await owner.select("connection_pending");

    // Desktop shows the QR for an unbound bot without waiting for 刷新二维码.
    expect(started).toEqual(["connection_pending"]);
    expect(owner.getSnapshot().authorization?.sessionId).toBe("sess-2");
    release();
    owner.dispose();
  });

  it("refuses to start a WeChat authorization for a bot on another platform", async () => {
    let started = 0;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({
          connections: [connection({ connectionId: "connection_feishu", state: "configured" })],
        }),
        startChannelWechatBind: async () => {
          started += 1;
          return { ok: true, sessionId: "unused" };
        },
      },
    });

    await owner.load();
    const result = await owner.refreshAuthorization("connection_feishu");

    // Feishu is bound through the credential form; calling the WeChat route for it would be a
    // request the runtime cannot answer.
    expect(started).toBe(0);
    expect(result.ok).toBe(false);
    expect(owner.getSnapshot().actionError).not.toBeUndefined();
  });

  it("does not restart the authorization of a bot that is already bound", async () => {
    let started = 0;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({ connections: [boundWechat()] }),
        startChannelWechatBind: async () => {
          started += 1;
          return { ok: true, sessionId: "unused" };
        },
      },
    });

    await owner.load();
    await owner.select("connection_wechat");

    expect(started).toBe(0);
    expect(owner.getSnapshot().authorization).toBeUndefined();
  });

  it("re-reads the list and drops the authorization once the scan is confirmed", async () => {
    let bound = false;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({
          connections: [
            connection({
              connectionId: "connection_pending",
              channel: "wechat",
              state: bound ? "bound" : "authorizing",
              ...(bound
                ? { binding: { bindingId: "b1", externalId: "wechat:mavis" } }
                : {}),
            }),
          ],
        }),
        startChannelWechatBind: async () => ({ ok: true, sessionId: "sess-3" }),
        getChannelWechatBindStatus: async () => ({ status: "confirmed" }),
      },
    });

    await owner.load();
    const release = owner.startRefreshing();
    await owner.select("connection_pending");
    bound = true;
    await owner.readAuthorization();

    expect(owner.getSnapshot().connections[0].state).toBe("bound");
    expect(owner.getSnapshot().authorization).toBeUndefined();
    expect(webuiChannelRows(owner.getSnapshot().connections)[0].stateLabel).toBe("已绑定");
    release();
    owner.dispose();
  });

  it("reports an expired scan on the card rather than as a bound bot", async () => {
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({
          connections: [connection({ connectionId: "connection_pending", channel: "wechat", state: "authorizing" })],
        }),
        startChannelWechatBind: async () => ({ ok: true, sessionId: "sess-4" }),
        getChannelWechatBindStatus: async () => ({ status: "expired" }),
      },
    });

    await owner.load();
    const release = owner.startRefreshing();
    await owner.select("connection_pending");
    await owner.readAuthorization();

    expect(owner.getSnapshot().authorization?.status).toBe("expired");
    expect(webuiChannelRows(owner.getSnapshot().connections)[0].bound).toBe(false);
    release();
    owner.dispose();
  });

  it("unbinds one bot without removing it from the list", async () => {
    const disconnected: string[] = [];
    let unbound = false;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({
          connections: [boundWechat({ state: unbound ? "configured" : "bound" })],
        }),
        disconnectChannelConnection: async (request) => {
          disconnected.push(request.connectionId);
          unbound = true;
          return { success: true };
        },
      },
    });

    await owner.load();
    const result = await owner.disconnect("connection_wechat");

    expect(result).toEqual({ ok: true });
    expect(disconnected).toEqual(["connection_wechat"]);
    // 解除连接 keeps the bot; only 删除Bot removes it.
    expect(owner.getSnapshot().connections).toHaveLength(1);
    expect(owner.getSnapshot().connections[0].state).toBe("configured");
  });

  it("removes the bot and clears the selection when it was the one on screen", async () => {
    const deleted: string[] = [];
    let removed = false;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({ connections: removed ? [] : [boundWechat()] }),
        deleteChannelConnection: async (request) => {
          deleted.push(request.connectionId);
          removed = true;
          return { success: true };
        },
      },
    });

    await owner.load();
    await owner.select("connection_wechat");
    const result = await owner.deleteBot("connection_wechat");

    expect(result).toEqual({ ok: true });
    expect(deleted).toEqual(["connection_wechat"]);
    expect(owner.getSnapshot().connections).toEqual([]);
    expect(owner.getSnapshot().selectedId).toBeUndefined();
  });

  it("binds a prepared Feishu bot by the connection it belongs to", async () => {
    const requests: string[] = [];
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({ connections: [connection({ state: "configured" })] }),
        connectChannel: async (request) => {
          requests.push(`${request.name}:${request.connectionId ?? ""}`);
          return { success: true };
        },
      },
    });

    await owner.load();
    const result = await owner.connect({
      name: "团队飞书机器人",
      appId: "cli_x",
      appSecret: "secret",
      connectionId: "connection_feishu",
    });

    expect(result).toEqual({ ok: true });
    expect(requests).toEqual(["团队飞书机器人:connection_feishu"]);
  });

  it("writes the message filter and publishes what the runtime stored", async () => {
    const owner = createWebuiChannelOwner({
      port: {
        listChannelConnections: async () => ({ connections: [boundWechat()] }),
        updateChannelMessageFilter: async (request) => request.filter,
      },
    });

    const result = await owner.updateMessageFilter({
      agent: "wechat:mavis",
      filter: { mode: "full", includeToolSummary: true },
    });

    expect(result).toEqual({ ok: true });
    expect(owner.getSnapshot().filter).toEqual({ mode: "full", includeToolSummary: true });
  });
});

describe("the rendered 接入 IM pane", () => {
  it("lists every bot with its platform label, including the ones that are not bound", () => {
    const markup = view(
      snapshot({
        connections: [
          boundWechat(),
          connection({ connectionId: "connection_feishu", state: "configured" }),
        ],
        selectedId: "connection_wechat",
      }),
    );

    expect(markup).toContain("ClawBot");
    expect(markup).toContain("新 Bot");
    expect(markup).toContain("微信");
    expect(markup).toContain("飞书");
    expect(markup).toContain('data-webui-channel-row="connection_feishu"');
    expect(markup).toContain("创建 IM Bot");
  });

  it("offers the platform menu the Desktop's create action opens", () => {
    // The menu is a popup: it renders its entries only while it is open.
    const markup = view(snapshot({ connections: [] }), true);

    expect(markup).toContain('data-webui-channel-add="wechat"');
    expect(markup).toContain('data-webui-channel-add="feishu"');
  });

  it("shows the empty state only for a successful empty read", () => {
    expect(view(snapshot({ status: "ready", connections: [] }))).toContain(WEBUI_CHANNEL_EMPTY_TEXT);
    // A failed read is not empty: saying so would invite the reader to bind a bot again.
    const failed = view(snapshot({ status: "error", connections: [], error: "读不到" }));
    expect(failed).not.toContain(WEBUI_CHANNEL_EMPTY_TEXT);
    // The failure is said once, through the toast, and the pane keeps its own
    // layout: the reason is not drawn where the bots are listed.
    expect(failed).not.toContain("读不到");
    expect(failed).not.toContain('data-webui-channel-error="true"');
    expect(failed).toContain('data-webui-component="channel-connect-panel"');
  });

  /* The two failures the pane can carry are events, not states: each is said
   * once, through the shared toast, and neither is drawn in the pane's own
   * layout (ADR 0030). The toast is raised in an effect and drawn over the
   * page, so a server render cannot see it — the pane's own source is what
   * pins that the failures are reported at all. */
  it("raises the snapshot failure and the action failure through the toast", () => {
    expect(panelSource).toContain("useWebuiToastError(");
    expect(panelSource).toContain("props.snapshot.error");
    expect(panelSource).toContain("props.snapshot.actionError");
    // And the pane's own layout draws neither of them any more.
    expect(panelSource).not.toContain('data-webui-channel-error="true"');
    expect(panelSource).not.toContain('data-webui-channel-action-error="true"');
  });

  it("draws a bound bot with the association copy, 解除连接, and no QR", () => {
    const markup = view(snapshot({ connections: [boundWechat()], selectedId: "connection_wechat" }));

    expect(markup).toContain('data-webui-component="channel-detail-card"');
    expect(markup).toContain("已绑定");
    expect(markup).toContain("已关联微信，可解除或新建 bot");
    expect(markup).toContain('data-webui-channel-unbind="true"');
    expect(markup).not.toContain('data-testid="authorization-qr-container"');
    expect(markup).not.toContain("刷新二维码");
  });

  it("draws an unbound bot with the QR, 刷新二维码, and no 解除连接", () => {
    const markup = view(
      snapshot({
        connections: [connection({ connectionId: "connection_pending", channel: "wechat", state: "authorizing" })],
        selectedId: "connection_pending",
        authorization: {
          connectionId: "connection_pending",
          platform: "wechat",
          status: "pending",
          qrContent: "https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=5552f5c5",
          sessionId: "sess-1",
        },
      }),
    );

    expect(markup).toContain("未绑定");
    expect(markup).toContain("扫描二维码绑定");
    expect(markup).toContain('data-webui-channel-refresh-authorization="true"');
    expect(markup).toContain('data-testid="authorization-qr-container"');
    expect(markup).not.toContain('data-webui-channel-unbind="true"');
    // The runtime answers the WeChat bind route with the link the phone opens rather than with a
    // picture, so the pane encodes it inline — the branch Desktop takes for text.
    expect(markup).toContain('data-testid="authorization-qr-code"');
    expect(markup).toContain("<svg");
    expect(markup).toContain("微信扫码授权以绑定MiniMax Code");
    expect(markup).toContain("机器人将自动绑定");
  });

  it("draws an image QR when the runtime produced a picture", () => {
    const markup = view(
      snapshot({
        connections: [connection({ connectionId: "connection_pending", channel: "wechat", state: "authorizing" })],
        selectedId: "connection_pending",
        authorization: {
          connectionId: "connection_pending",
          platform: "wechat",
          status: "pending",
          qrImageUrl: "data:image/png;base64,AAAA",
          sessionId: "sess-1",
        },
      }),
    );

    expect(markup).toContain('data-testid="authorization-qr-image"');
    expect(markup).not.toContain('data-testid="authorization-qr-code"');
  });

  it("asks an unbound Feishu bot for its credentials instead of showing a QR", () => {
    const markup = view(
      snapshot({
        connections: [connection({ connectionId: "connection_feishu", state: "configured" })],
        selectedId: "connection_feishu",
      }),
    );

    // Declared substitution: this runtime serves Feishu through its credential bind, so the
    // form is the action — a 刷新二维码 button here would call a route that does not exist.
    expect(markup).toContain('data-webui-channel-bind-form="true"');
    expect(markup).toContain("飞书 App ID");
    expect(markup).toContain("飞书 App Secret");
    expect(markup).not.toContain('data-testid="authorization-qr-container"');
    expect(markup).not.toContain('data-webui-channel-refresh-authorization="true"');
  });

  it("marks the sections the runtime has no route behind as not wired", () => {
    const markup = view(snapshot({ connections: [boundWechat()], selectedId: "connection_wechat" }));

    expect(markup).toContain(WEBUI_CHANNEL_NOT_WIRED);
    expect(markup).toContain(WEBUI_CHANNEL_SECTION_WORKSPACE);
    expect(markup).toContain(WEBUI_CHANNEL_SECTION_DELETE);
    expect(markup).toContain('data-webui-channel-section="workspace"');
    expect(markup).toContain('data-webui-channel-delete="true"');
  });

  it("shows the bound bot's message filter", () => {
    const markup = view(
      snapshot({
        connections: [boundWechat()],
        selectedId: "connection_wechat",
        filter: { mode: "full", includeToolSummary: true },
      }),
    );

    expect(markup).toContain("完整输出");
    expect(markup).toContain('data-webui-channel-filter-mode="full"');
  });

  it("names the agent's configuration state where the projection reads it", () => {
    // The Desktop's Agent slot carries the selector alone, so the configuration state stays in
    // the projection rather than in the slot.
    expect(webuiChannelConfigLabel({ configured: true })).toBe("已配置");
    expect(webuiChannelConfigLabel({ configured: false })).toBe("未配置");
    expect(webuiChannelConfigLabel(undefined)).toBe("未读取");
  });
});
