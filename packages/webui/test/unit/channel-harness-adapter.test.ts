/**
 * The 接入 IM cell of the harness port.
 *
 * Two claims, both about the boundary rather than about the channel bridge:
 *
 *   * the runtime's channel-bridge answers convert into the WebUI's own wire DTOs — every required
 *     field read or failed on, every optional field elided rather than emitted as `undefined`, the
 *     bot's own state carried through untouched, and a refusal reported as the runtime's own code;
 *   * a host that carries no channel bridge answers with one `capability_unavailable` refusal
 *     instead of an empty bot list that reads as "no IM bot exists".
 *
 * The real adapter and the real conversions run here; only the host leaves are scripted.
 */
import { describe, expect, it } from "vitest";

import {
  createChannelAdapter,
  type WebuiRuntimeChannelBridge,
} from "../../src/runtime/harness/channel.js";
import type { WebuiHarnessPort } from "../../src/runtime/port.js";

type ChannelPort = Pick<
  WebuiHarnessPort,
  | "listChannelConnections"
  | "prepareChannelConnection"
  | "connectChannel"
  | "disconnectChannelConnection"
  | "deleteChannelConnection"
  | "checkChannelConfig"
  | "getChannelMessageFilter"
  | "updateChannelMessageFilter"
>;

/** The runtime's channel-bridge surface, as the host hands it over. */
function bridgeStub(overrides: Partial<WebuiRuntimeChannelBridge> = {}): WebuiRuntimeChannelBridge {
  return {
    listConnections: async () => ({ connections: [] }),
    connect: async () => ({ ok: true }),
    checkConfig: async () => ({ configured: true }),
    getMessageFilter: async () => ({ mode: "result", includeToolSummary: false }),
    updateMessageFilter: async () => ({ mode: "result", includeToolSummary: false }),
    ...overrides,
  };
}

/** A host that publishes the bridge the way the runtime host does: on the api host. */
function adapterWith(bridge: WebuiRuntimeChannelBridge): ChannelPort {
  return createChannelAdapter({
    apiHost: { close: async () => {}, channelBridge: bridge } as never,
  });
}

/** Settles a refusal: an `Error`'s `message` is not an own enumerable property, so read it. */
async function refusal(call: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  const error = (await call().catch((reason: unknown) => reason)) as {
    code?: string;
    message?: string;
  };
  return { ...(error.code === undefined ? {} : { code: error.code }), message: error.message ?? "" };
}

describe("the 接入 IM adapter", () => {
  it("converts the runtime's bots into the wire bots, state included", async () => {
    const port = adapterWith(
      bridgeStub({
        listConnections: async () => ({
          connections: [
            {
              connectionId: "connection_wechat",
              channel: "wechat",
              agentName: "mavis",
              projectKey: null,
              state: "authorizing",
              createdAt: 1,
              updatedAt: 2,
            },
            {
              connectionId: "connection_feishu",
              channel: "feishu",
              agentName: "mavis",
              projectKey: "default",
              state: "bound",
              binding: {
                bindingId: "binding_1",
                externalId: "mavis",
                label: "团队飞书机器人",
                currentSessionId: "mvs_1",
                createdAt: 3,
                updatedAt: 4,
              },
              createdAt: 3,
              updatedAt: 4,
            },
          ],
        }),
      }),
    );

    const list = await port.listChannelConnections();

    expect(list).toEqual({
      connections: [
        {
          connectionId: "connection_wechat",
          channel: "wechat",
          agentName: "mavis",
          projectKey: null,
          // The state is carried through: a bot still waiting for its scan is authorizing, not
          // bound, and the pane draws it that way.
          state: "authorizing",
        },
        {
          connectionId: "connection_feishu",
          channel: "feishu",
          agentName: "mavis",
          projectKey: "default",
          state: "bound",
          binding: {
            bindingId: "binding_1",
            externalId: "mavis",
            label: "团队飞书机器人",
            currentSessionId: "mvs_1",
          },
        },
      ],
    });
  });

  it("elides the binding label a bot's adapter did not report", async () => {
    const port = adapterWith(
      bridgeStub({
        listConnections: async () => ({
          connections: [
            {
              connectionId: "connection_1",
              channel: "feishu",
              agentName: "mavis",
              projectKey: null,
              state: "bound",
              binding: {
                bindingId: "binding_1",
                externalId: "mavis",
                createdAt: 1,
                updatedAt: 2,
              },
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        }),
      }),
    );

    const [connection] = (await port.listChannelConnections()).connections;

    expect(connection.binding).toEqual({ bindingId: "binding_1", externalId: "mavis" });
  });

  it("fails on a bot the runtime could not name, rather than drawing a guessed one", async () => {
    const port = adapterWith(
      bridgeStub({
        listConnections: async () => ({
          connections: [
            {
              connectionId: "",
              channel: "feishu",
              agentName: "mavis",
              projectKey: null,
              state: "bound",
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        }),
      }),
    );

    const failure = await refusal(() => port.listChannelConnections());

    expect(failure.message).toContain("connectionId");
  });

  it("fails on a bot whose state the wire does not declare", async () => {
    const port = adapterWith(
      bridgeStub({
        listConnections: async () => ({
          connections: [
            {
              connectionId: "connection_1",
              channel: "feishu",
              agentName: "mavis",
              projectKey: null,
              state: "mystery" as never,
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        }),
      }),
    );

    const failure = await refusal(() => port.listChannelConnections());

    expect(failure.message).toContain("state");
  });

  it("fails on a list that carries no bots at all", async () => {
    const port = adapterWith(
      bridgeStub({
        listConnections: async () => ({ connections: undefined }) as never,
      }),
    );

    const failure = await refusal(() => port.listChannelConnections());

    expect(failure.message).toContain("bot list");
  });

  it("forwards the bot creation by the platform the menu picked", async () => {
    const seen: unknown[] = [];
    const port = adapterWith(
      bridgeStub({
        prepareConnection: async (request) => {
          seen.push(request);
          return { ok: true };
        },
      }),
    );

    const result = await port.prepareChannelConnection({ platform: "wechat" });

    expect(seen).toEqual([{ platform: "wechat" }]);
    expect(result).toEqual({ success: true });
  });

  it("reports a refused bot creation as the runtime's own code", async () => {
    const port = adapterWith(
      bridgeStub({
        prepareConnection: async () => ({
          ok: false,
          error: "Channel Connections require the Local Runtime V2 Conversation composition.",
          code: "CHANNEL_CONNECTIONS_UNAVAILABLE",
        }),
      }),
    );

    const result = await port.prepareChannelConnection({ platform: "wechat" });

    expect(result).toEqual({
      success: false,
      error:
        "CHANNEL_CONNECTIONS_UNAVAILABLE: Channel Connections require the Local Runtime V2 Conversation composition.",
    });
  });

  it("forwards the bind and reports the runtime's own verdict", async () => {
    const seen: unknown[] = [];
    const port = adapterWith(
      bridgeStub({
        connect: async (request) => {
          seen.push(request);
          return {
            ok: false,
            error: "Local channel platform runner is not implemented.",
            code: "LOCAL_CHANNEL_RUNNER_UNAVAILABLE",
          };
        },
      }),
    );

    const result = await port.connectChannel({
      name: "mavis",
      appId: "cli_x",
      appSecret: "secret",
      connectionId: "connection_feishu",
    });

    expect(seen).toEqual([
      { name: "mavis", appId: "cli_x", appSecret: "secret", connectionId: "connection_feishu" },
    ]);
    expect(result).toEqual({
      success: false,
      error: "LOCAL_CHANNEL_RUNNER_UNAVAILABLE: Local channel platform runner is not implemented.",
    });
  });

  it("unbinds and deletes by the bot's connection", async () => {
    const unbindSeen: unknown[] = [];
    const deleteSeen: unknown[] = [];
    const port = adapterWith(
      bridgeStub({
        disconnectConnection: async (request) => {
          unbindSeen.push(request);
          return { ok: true };
        },
        deleteConnection: async (request) => {
          deleteSeen.push(request);
          return { ok: true };
        },
      }),
    );

    expect(await port.disconnectChannelConnection({ connectionId: "connection_1" })).toEqual({
      success: true,
    });
    expect(await port.deleteChannelConnection({ connectionId: "connection_1" })).toEqual({
      success: true,
    });
    expect(unbindSeen).toEqual([{ connectionId: "connection_1" }]);
    expect(deleteSeen).toEqual([{ connectionId: "connection_1" }]);
  });

  it("reports a deletion the runtime did not perform as a refusal", async () => {
    const port = adapterWith(
      bridgeStub({
        deleteConnection: async () => ({ ok: false, error: "No IM bot was stored under that id." }),
      }),
    );

    expect(await port.deleteChannelConnection({ connectionId: "connection_missing" })).toEqual({
      success: false,
      error: "No IM bot was stored under that id.",
    });
  });

  it("converts the per-agent configuration state", async () => {
    const port = adapterWith(
      bridgeStub({
        checkConfig: async () => ({
          configured: false,
          detail: "Channel config for feishu is ambiguous",
        }),
      }),
    );

    expect(await port.checkChannelConfig({ agent: "mavis" })).toEqual({
      configured: false,
      detail: "Channel config for feishu is ambiguous",
    });
  });

  it("converts the message filter and fails on a mode the wire does not declare", async () => {
    const port = adapterWith(
      bridgeStub({
        getMessageFilter: async () => ({ mode: "full", includeToolSummary: true }),
        updateMessageFilter: async () => ({ mode: "nonsense", includeToolSummary: false }),
      }),
    );

    expect(await port.getChannelMessageFilter({ agent: "wechat:mavis" })).toEqual({
      mode: "full",
      includeToolSummary: true,
    });
    const failure = await refusal(() =>
      port.updateChannelMessageFilter({
        agent: "wechat:mavis",
        filter: { mode: "result", includeToolSummary: false },
      }),
    );
    expect(failure.message).toContain("filter.mode");
  });

  it("refuses every member once, when the host carries no channel bridge", async () => {
    const port = createChannelAdapter({ apiHost: { close: async () => {} } });

    const failure = await refusal(() => port.listChannelConnections());

    expect(failure.code).toBe("capability_unavailable");
    expect(failure.message).toBe("runtime host does not expose the channel bridge");
  });

  it("reads the bridge from a host slot as well as from the api host", async () => {
    const port = createChannelAdapter({
      apiHost: { close: async () => {} },
      channelBridge: bridgeStub({
        listConnections: async () => ({
          connections: [
            {
              connectionId: "connection_1",
              channel: "feishu",
              agentName: "mavis",
              projectKey: null,
              state: "configured",
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        }),
      }),
    } as never);

    expect(await port.listChannelConnections()).toEqual({
      connections: [
        {
          connectionId: "connection_1",
          channel: "feishu",
          agentName: "mavis",
          projectKey: null,
          state: "configured",
        },
      ],
    });
  });

  it("forwards a host that already carries the members", async () => {
    // `host-contract.ts` declares the slot for a host that answers the 接入 IM members itself;
    // the adapter forwards those as they are.
    const port = createChannelAdapter({
      apiHost: { close: async () => {} },
      listChannelConnections: async () => ({
        connections: [
          {
            connectionId: "connection_1",
            channel: "feishu",
            agentName: "mavis",
            projectKey: null,
            state: "bound",
          },
        ],
      }),
      prepareChannelConnection: async () => ({ success: true }),
      connectChannel: async () => ({ success: true }),
      disconnectChannelConnection: async () => ({ success: true }),
      deleteChannelConnection: async () => ({ success: true }),
      checkChannelConfig: async () => ({ configured: true }),
      getChannelMessageFilter: async () => ({ mode: "result", includeToolSummary: false }),
      updateChannelMessageFilter: async () => ({ mode: "full", includeToolSummary: true }),
      startChannelWechatBind: async () => ({ ok: true }),
      getChannelWechatBindStatus: async () => ({ status: "pending" as const }),
    } as never);

    expect(await port.listChannelConnections()).toEqual({
      connections: [
        {
          connectionId: "connection_1",
          channel: "feishu",
          agentName: "mavis",
          projectKey: null,
          state: "bound",
        },
      ],
    });
    expect(
      await port.updateChannelMessageFilter({
        agent: "mavis",
        filter: { mode: "full", includeToolSummary: true },
      }),
    ).toEqual({ mode: "full", includeToolSummary: true });
  });
});
