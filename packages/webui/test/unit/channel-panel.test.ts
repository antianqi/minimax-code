/**
 * The 接入 IM pane: projection, owner transitions, and the rendered branches.
 *
 * The claims are asserted where they are made rather than through a browser: the rows' wording,
 * the empty state, the refusal a host without an IM channel service gets, the create flow's
 * authorization, and the sections the runtime has no route behind. Rendering goes through
 * `renderToStaticMarkup` — this package has no jsdom.
 */
import { renderToStaticMarkup } from "react-dom/server";
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
  webuiChannelPendingRow,
  webuiChannelPlatformLabel,
  webuiChannelRows,
} from "../../src/client/features/channel/projection/channel-panel.js";
import { ChannelConnectPanelView } from "../../src/client/features/channel/ui/ChannelConnectPanel.public.js";
import type { WebuiChannelClient } from "../../src/shared/contracts/channel.js";

function client(overrides: Partial<WebuiChannelClient> = {}): WebuiChannelClient {
  return { name: "mavis", platform: "feishu", agentName: "mavis", ...overrides };
}

function snapshot(overrides: Partial<WebuiChannelSnapshot> = {}): WebuiChannelSnapshot {
  return { status: "ready", clients: [], ...overrides };
}

const noop = (): void => {};

function view(snap: WebuiChannelSnapshot, menuOpen = false): string {
  // The pure view carries no hooks, so it is called the way the house style calls it: this file
  // is a `.ts` and the package has no JSX transform for one.
  return renderToStaticMarkup(
    ChannelConnectPanelView({
      snapshot: snap,
      onSelect: noop,
      onBind: noop,
      onUnbind: noop,
      onUpdateFilter: noop,
      menuOpen: menuOpen,
      onMenuOpenChange: noop,
      binding: false,
      onOpenBinding: noop,
      onCloseBinding: noop,
      deleting: false,
      onOpenDelete: noop,
      onCloseDelete: noop,
      onStartAdding: noop,
      onCancelAdding: noop,
      onRenewAuthorization: noop,
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

  it("keys every row by the client's own name and falls back to the default agent", () => {
    const rows = webuiChannelRows(
      [client(), client({ name: "wechat:mavis", platform: "wechat", agentName: undefined })],
      "wechat:mavis",
    );

    expect(rows).toEqual([
      {
        name: "mavis",
        platform: "feishu",
        platformLabel: "飞书",
        agentLabel: "mavis",
        selected: false,
        botName: "mavis",
        bound: true,
        stateLabel: "已绑定",
      },
      {
        name: "wechat:mavis",
        platform: "wechat",
        platformLabel: "微信",
        agentLabel: "默认",
        selected: true,
        botName: "ClawBot",
        bound: true,
        stateLabel: "已绑定",
      },
    ]);
  });

  it("builds the bot the create flow adds as an unbound row", () => {
    // Desktop adds a bot by preparing it: the new bot is not bound yet, so its card carries the
    // unbound state.
    expect(webuiChannelPendingRow("wechat", "ClawBot")).toEqual({
      name: "ClawBot",
      platform: "wechat",
      platformLabel: "微信",
      agentLabel: "默认",
      selected: true,
      botName: "ClawBot",
      bound: false,
      stateLabel: "未绑定",
    });
    expect(webuiChannelPendingRow("feishu", "新 Bot").botName).toBe("新 Bot");
  });
});

describe("the 接入 IM owner", () => {
  it("refuses once when the transport carries no IM channel service", async () => {
    const owner = createWebuiChannelOwner({ port: {} });

    await owner.load();

    expect(owner.getSnapshot().status).toBe("error");
    expect(owner.getSnapshot().error).toBe(WEBUI_CHANNEL_UNAVAILABLE);
    // A refusal is not an empty list: the pane must not read as "no IM client is bound".
    expect(owner.getSnapshot().clients).toEqual([]);
  });

  it("reads the bound clients and keeps them when the next read fails", async () => {
    let fail = false;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelStatus: async () => {
          if (fail) throw new Error("the channel service went away");
          return { clients: [client()] };
        },
      },
    });

    await owner.load();
    expect(owner.getSnapshot().status).toBe("ready");
    expect(owner.getSnapshot().clients).toEqual([client()]);

    fail = true;
    await owner.load();
    expect(owner.getSnapshot().status).toBe("error");
    expect(owner.getSnapshot().error).toBe("the channel service went away");
    // The last good rows stay on screen next to the failure.
    expect(owner.getSnapshot().clients).toEqual([client()]);
  });

  it("reads the agent's configuration and the client's own message filter on selection", async () => {
    const configAgents: string[] = [];
    const filterKeys: string[] = [];
    const owner = createWebuiChannelOwner({
      port: {
        listChannelStatus: async () => ({ clients: [client({ name: "wechat:mavis", platform: "wechat" })] }),
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
    await owner.select("wechat:mavis");

    // The configuration belongs to the agent; the filter belongs to the IM client.
    expect(configAgents).toEqual(["mavis"]);
    expect(filterKeys).toEqual(["wechat:mavis"]);
    expect(owner.getSnapshot().config).toEqual({ configured: true });
    expect(owner.getSnapshot().filter).toEqual({ mode: "full", includeToolSummary: true });
  });

  it("reports a refused bind as a value instead of a success", async () => {
    const owner = createWebuiChannelOwner({
      port: {
        listChannelStatus: async () => ({ clients: [] }),
        connectChannel: async () => ({
          success: false,
          error: "LOCAL_CHANNEL_RUNNER_UNAVAILABLE: no platform runner",
        }),
      },
    });

    const result = await owner.connect({ name: "mavis", appId: "cli_x", appSecret: "secret" });

    expect(result).toEqual({
      ok: false,
      message: "LOCAL_CHANNEL_RUNNER_UNAVAILABLE: no platform runner",
    });
    expect(owner.getSnapshot().actionError).toBe(
      "LOCAL_CHANNEL_RUNNER_UNAVAILABLE: no platform runner",
    );
  });

  it("writes the message filter and publishes what the runtime stored", async () => {
    const owner = createWebuiChannelOwner({
      port: {
        listChannelStatus: async () => ({ clients: [client()] }),
        updateChannelMessageFilter: async (request) => request.filter,
      },
    });

    const result = await owner.updateMessageFilter({
      agent: "mavis",
      filter: { mode: "full", includeToolSummary: true },
    });

    expect(result).toEqual({ ok: true });
    expect(owner.getSnapshot().filter).toEqual({ mode: "full", includeToolSummary: true });
  });

  it("starts the WeChat authorization and publishes the QR it produced", async () => {
    const owner = createWebuiChannelOwner({
      port: {
        listChannelStatus: async () => ({ clients: [] }),
        startChannelWechatBind: async () => ({
          ok: true,
          sessionId: "sess-1",
          qrImageUrl: "data:image/png;base64,AAAA",
        }),
      },
    });

    const result = await owner.startAdding("wechat");

    expect(result).toEqual({ ok: true });
    expect(owner.getSnapshot().addPlatform).toBe("wechat");
    expect(owner.getSnapshot().authorization).toEqual({
      platform: "wechat",
      status: "pending",
      qrImageUrl: "data:image/png;base64,AAAA",
      sessionId: "sess-1",
    });
  });

  it("reports a refused authorization as a value, not a pending QR", async () => {
    const owner = createWebuiChannelOwner({
      port: {
        listChannelStatus: async () => ({ clients: [] }),
        startChannelWechatBind: async () => ({
          ok: false,
          error: "LOCAL_CHANNEL_RUNNER_UNAVAILABLE: no platform runner",
        }),
      },
    });

    const result = await owner.startAdding("wechat");

    expect(result.ok).toBe(false);
    expect(owner.getSnapshot().authorization?.status).toBe("error");
    expect(owner.getSnapshot().authorization?.error).toBe(
      "LOCAL_CHANNEL_RUNNER_UNAVAILABLE: no platform runner",
    );
  });

  it("closes the create flow and re-reads the list once the authorization is confirmed", async () => {
    let bound = false;
    const owner = createWebuiChannelOwner({
      port: {
        listChannelStatus: async () => ({ clients: bound ? [client({ name: "wechat:mavis", platform: "wechat" })] : [] }),
        startChannelWechatBind: async () => ({ ok: true, sessionId: "sess-1" }),
        getChannelWechatBindStatus: async () => ({ status: "confirmed" }),
      },
    });

    await owner.startAdding("wechat");
    bound = true;
    await owner.readAuthorization();

    // The bot is bound, so it belongs in the list and the create flow is over.
    expect(owner.getSnapshot().clients.map((entry) => entry.name)).toEqual(["wechat:mavis"]);
    expect(owner.getSnapshot().addPlatform).toBeUndefined();
    expect(owner.getSnapshot().authorization).toBeUndefined();
  });
});

describe("the rendered 接入 IM pane", () => {
  it("lists every bound client with its platform label", () => {
    const markup = view(
      snapshot({
        clients: [client(), client({ name: "wechat:mavis", platform: "wechat" })],
        selectedName: "mavis",
      }),
    );

    expect(markup).toContain("飞书");
    expect(markup).toContain("微信");
    expect(markup).toContain('data-webui-channel-row="wechat:mavis"');
    // The Desktop names a WeChat bot ClawBot and every other bot after its binding.
    expect(markup).toContain("ClawBot");
    expect(markup).toContain("创建 IM Bot");
  });

  it("offers the platform menu the Desktop's create action opens", () => {
    // The menu is a popup: it renders its entries only while it is open.
    const markup = view(snapshot({ clients: [], status: "ready" }), true);

    expect(markup).toContain('data-webui-channel-add="wechat"');
    expect(markup).toContain('data-webui-channel-add="feishu"');
  });

  it("shows the empty state only for a successful empty read", () => {
    expect(view(snapshot({ status: "ready", clients: [] }))).toContain(WEBUI_CHANNEL_EMPTY_TEXT);
    // A failed read is not empty: saying so would invite the reader to bind a client again.
    expect(view(snapshot({ status: "error", clients: [], error: "读不到" }))).not.toContain(
      WEBUI_CHANNEL_EMPTY_TEXT,
    );
    expect(view(snapshot({ status: "error", clients: [], error: "读不到" }))).toContain("读不到");
  });

  it("marks the sections the runtime has no route behind as not wired", () => {
    const markup = view(snapshot({ clients: [client()], selectedName: "mavis" }));

    expect(markup).toContain(WEBUI_CHANNEL_NOT_WIRED);
    expect(markup).toContain(WEBUI_CHANNEL_SECTION_WORKSPACE);
    expect(markup).toContain(WEBUI_CHANNEL_SECTION_DELETE);
    expect(markup).toContain('data-webui-channel-section="workspace"');
  });

  it("shows the selected bot's card with the Desktop's header and sections", () => {
    const markup = view(snapshot({ clients: [client()], selectedName: "mavis" }));

    expect(markup).toContain('data-webui-component="channel-detail-card"');
    expect(markup).toContain('data-webui-channel-section="association"');
    expect(markup).toContain('data-webui-channel-section="agent"');
    expect(markup).toContain('data-webui-channel-section="delete"');
    expect(markup).toContain("绑定机器人");
    expect(markup).toContain("已关联飞书，可解除或新建 bot");
    expect(markup).toContain("解除连接");
  });

  it("shows the bot the create flow adds as an unbound card with its QR", () => {
    const markup = view(
      snapshot({
        clients: [],
        status: "ready",
        addPlatform: "wechat",
        authorization: {
          platform: "wechat",
          status: "pending",
          qrImageUrl: "data:image/png;base64,AAAA",
          sessionId: "sess-1",
        },
      }),
    );

    // The unbound card is the Desktop's other shape: the QR, the copy and the pairing code.
    expect(markup).toContain('data-testid="authorization-qr-container"');
    expect(markup).toContain('data-testid="authorization-qr-image"');
    expect(markup).toContain("微信扫码授权以绑定MiniMax Code");
    expect(markup).toContain("机器人将自动绑定");
    expect(markup).toContain("未绑定");
    // A bot that is being added is not in the list yet.
    expect(markup).not.toContain(WEBUI_CHANNEL_EMPTY_TEXT);
  });

  it("encodes the text the runtime produced as a QR, the way Desktop does", () => {
    const markup = view(
      snapshot({
        clients: [],
        status: "ready",
        addPlatform: "wechat",
        authorization: {
          platform: "wechat",
          status: "pending",
          qrContent: "https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=5552f5c5",
          sessionId: "sess-1",
        },
      }),
    );

    // The WeChat bind route answers with the link the phone opens rather than with a picture, so
    // the pane encodes it inline — the branch Desktop takes when the runtime answers with text.
    expect(markup).toContain('data-testid="authorization-qr-container"');
    expect(markup).toContain('data-testid="authorization-qr-code"');
    expect(markup).toContain("<svg");
    expect(markup).not.toContain('data-testid="authorization-qr-image"');
  });

  it("shows the selected client's message filter", () => {
    const markup = view(
      snapshot({
        clients: [client()],
        selectedName: "mavis",
        config: { configured: true },
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
