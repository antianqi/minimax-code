/**
 * The runtime's public IM channel-bridge surface.
 *
 * One claim, and it is the one that matters for the WebUI's 接入 IM tab: the surface forwards to
 * the channel-bridge routes the runtime already serves, and it does not re-implement any of them.
 * The proof is that the route answers come back unchanged — the clients the status route reports,
 * the filter the store holds, the refusal a bind route sends — and that a host without the
 * channel service refuses every call instead of answering an empty list.
 *
 * Only the runtime's leaves are scripted here: the dispatcher, the platform adapters and the
 * stores are the real ones.
 */
import { describe, expect, it } from "vitest";

import { createLocalChannelBridgeSurface } from "../../src/api/channel-bridge-surface.js";
import type { LocalChannelBridgeInfra } from "../../src/channels/infra.js";

/** The runtime's channel-bridge infrastructure, with only the leaves scripted. */
function infraStub(overrides: Record<string, unknown> = {}): LocalChannelBridgeInfra {
  return {
    status: async () => ({ clients: {}, localRuntime: true }),
    bindingStore: {
      list: async () => [],
      getMessageFilter: async () => ({ mode: "result", includeToolSummary: false }),
      setMessageFilter: async (_key: string, filter: unknown) => filter,
    },
    routeResolver: { resolveLegacy: async () => ({ blocked: true }) },
    resolveAgentReadScope: async (name: string) => ({
      canonicalName: name,
      compatibleNames: [name],
    }),
    resolveAgentWriteTarget: async (name: string) => name,
    reportResourceAmbiguity: () => undefined,
    ...overrides,
  } as unknown as LocalChannelBridgeInfra;
}

/** One platform adapter, with only the leaves the route under test touches scripted. */
function feishuStub(overrides: Record<string, unknown> = {}) {
  return {
    statusClients: async () => ({
      mavis: { ok: true, platform: "feishu", clientId: "mavis", agentName: "mavis", connected: true },
    }),
    configCheck: async (agentName?: string) => ({
      configured: agentName === "mavis",
      source: "local-runtime",
      hasCredentials: true,
      platform: "feishu",
      clientId: agentName ?? "mavis",
      localRuntime: true,
    }),
    bindBody: async (body: Record<string, unknown>) => ({
      record: { agentName: "mavis", clientId: String(body.name ?? "mavis") },
    }),
    hasBindingBody: async () => true,
    unbind: async () =>
      new Response(JSON.stringify({ ok: true, unbound: true, disconnected: true }), {
        headers: { "content-type": "application/json" },
      }),
    unbindBody: async () =>
      new Response(JSON.stringify({ ok: true, unbound: true, disconnected: true }), {
        headers: { "content-type": "application/json" },
      }),
    ...overrides,
  } as never;
}

describe("the runtime's channel-bridge surface", () => {
  it("reports the clients the status route reports", async () => {
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub(),
      feishu: feishuStub(),
      enabled: true,
    });

    expect(await surface.listStatus()).toEqual({
      clients: [{ name: "mavis", platform: "feishu", agentName: "mavis" }],
    });
  });

  it("answers the configuration check the route answers", async () => {
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub(),
      feishu: feishuStub(),
      enabled: true,
    });

    expect(await surface.checkConfig({ agent: "mavis" })).toEqual({ configured: true });
    expect(await surface.checkConfig({ agent: "nobody" })).toEqual({ configured: false });
  });

  it("reads and writes the message filter the store holds", async () => {
    const written: Array<{ key: string; filter: unknown }> = [];
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub({
        bindingStore: {
          getMessageFilter: async (key: string) => ({ key }),
          setMessageFilter: async (key: string, filter: unknown) => {
            written.push({ key, filter });
            return filter;
          },
        },
      }),
      enabled: true,
    });

    expect(await surface.getMessageFilter({ agent: "mavis" })).toEqual({
      mode: "result",
      includeToolSummary: false,
    });
    expect(
      await surface.updateMessageFilter({
        agent: "mavis",
        filter: { mode: "full", includeToolSummary: true },
      }),
    ).toEqual({ mode: "full", includeToolSummary: true });
    expect(written).toEqual([
      { key: "mavis", filter: { mode: "full", includeToolSummary: true } },
    ]);
  });

  it("forwards a bind and reports the route's own refusal", async () => {
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub(),
      feishu: feishuStub({
        bindBody: async () => ({
          error: new Response(JSON.stringify({ ok: false, error: "no", code: "NOPE" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        }),
      }),
      enabled: true,
    });

    expect(await surface.connect({ name: "mavis", appId: "cli_x", appSecret: "secret" })).toEqual({
      ok: false,
      error: "no",
      code: "NOPE",
    });
  });

  it("reports an unbind that removed nothing as a failure, not a success", async () => {
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub(),
      feishu: feishuStub({
        unbindBody: async () =>
          new Response(JSON.stringify({ ok: true, unbound: false, disconnected: false }), {
            headers: { "content-type": "application/json" },
          }),
      }),
      enabled: true,
    });

    const outcome = await surface.disconnect({ name: "mavis", clearCredentials: true });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("No IM client was bound");
  });

  it("refuses every call when the host carries no channel service", async () => {
    const surface = createLocalChannelBridgeSurface({ infra: infraStub(), enabled: false });

    await expect(surface.listStatus()).rejects.toThrow(/channel service is not available/);
    await expect(surface.connect({ name: "mavis" })).rejects.toThrow(
      /channel service is not available/,
    );
    await expect(surface.disconnect({ name: "mavis" })).rejects.toThrow(
      /channel service is not available/,
    );
    await expect(surface.checkConfig({ agent: "mavis" })).rejects.toThrow(
      /channel service is not available/,
    );
    await expect(surface.getMessageFilter({ agent: "mavis" })).rejects.toThrow(
      /channel service is not available/,
    );
    await expect(
      surface.updateMessageFilter({
        agent: "mavis",
        filter: { mode: "result", includeToolSummary: false },
      }),
    ).rejects.toThrow(/channel service is not available/);
  });
});

/** One Connection, as the store keeps it. */
function connectionRecord(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: "connection_1",
    agentName: "mavis",
    channel: "wechat",
    projectKey: null,
    resolvedProjectKey: "default",
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

/** The Connection store, with only the leaves the routes touch scripted. */
function connectionStoreStub(state: {
  views?: unknown[];
  deleted?: boolean;
  snapshot?: Record<string, unknown>;
}) {
  const calls: Record<string, unknown[]> = {
    prepare: [],
    deleteBinding: [],
    deleteConnection: [],
    cancelAuthorization: [],
  };
  return {
    calls,
    store: {
      listViews: async () => state.views ?? [],
      prepare: async (input: unknown) => {
        calls.prepare.push(input);
        // The real store persists the Connection, so the route's follow-up read sees it.
        const prepared = connectionRecord();
        state.views = [{ connection: prepared, state: "configured" }];
        return prepared;
      },
      getConnection: async (connectionId: string) =>
        connectionId === "connection_1" ? connectionRecord() : undefined,
      deleteBinding: async (connectionId: string) => {
        calls.deleteBinding.push(connectionId);
        return true;
      },
      deleteConnection: async (connectionId: string, beforeDelete?: (s: unknown) => Promise<void>) => {
        calls.deleteConnection.push(connectionId);
        if (state.snapshot) await beforeDelete?.(state.snapshot);
        return state.deleted ?? true;
      },
      getAuthorization: () => undefined,
      cancelAuthorization: async (connectionId: string) => {
        calls.cancelAuthorization.push(connectionId);
        return { hadAuthorization: false };
      },
    },
  };
}

describe("the runtime's Channel Connection routes, through the surface", () => {
  it("lists every bot with its own state, bound or not", async () => {
    const { store } = connectionStoreStub({
      views: [
        {
          connection: connectionRecord(),
          state: "configured",
        },
        {
          connection: connectionRecord({ connectionId: "connection_2", channel: "feishu" }),
          state: "bound",
          binding: {
            bindingId: "binding_2",
            connectionId: "connection_2",
            channel: "feishu",
            clientName: "mavis",
            currentSessionId: "mvs_1",
            createdAt: 30,
            updatedAt: 40,
          },
        },
      ],
    });
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub({ imConnectionStore: store }),
      feishu: feishuStub({
        statusClients: async () => ({ mavis: { botName: "团队飞书机器人" } }),
      }),
      enabled: true,
    });

    const list = await surface.listConnections();

    expect(list.connections).toEqual([
      {
        connectionId: "connection_1",
        channel: "wechat",
        agentName: "mavis",
        projectKey: null,
        state: "configured",
        createdAt: 10,
        updatedAt: 20,
      },
      {
        connectionId: "connection_2",
        channel: "feishu",
        agentName: "mavis",
        projectKey: null,
        state: "bound",
        binding: {
          bindingId: "binding_2",
          channel: "feishu",
          externalId: "mavis",
          // The adapter's own bot name, which Desktop shows as the row's label.
          label: "团队飞书机器人",
          currentSessionId: "mvs_1",
          createdAt: 30,
          updatedAt: 40,
        },
        createdAt: 10,
        updatedAt: 20,
      },
    ]);
  });

  it("creates a bot with no project selected, then reports the connection", async () => {
    const { calls, store } = connectionStoreStub({});
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub({ imConnectionStore: store }),
      enabled: true,
    });

    const prepared = await surface.prepareConnection({ platform: "wechat" });

    expect(calls.prepare).toEqual([
      { agentName: "mavis", channel: "wechat", projectKey: null, resolvedProjectKey: "default" },
    ]);
    expect(prepared).toEqual({
      ok: true,
      connection: {
        connectionId: "connection_1",
        channel: "wechat",
        agentName: "mavis",
        projectKey: null,
        state: "configured",
        createdAt: 10,
        updatedAt: 20,
      },
    });
  });

  it("refuses a bot creation on a platform the runtime does not serve", async () => {
    const { store } = connectionStoreStub({});
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub({ imConnectionStore: store }),
      enabled: true,
    });

    const prepared = await surface.prepareConnection({ platform: "slack" });

    expect(prepared.ok).toBe(false);
    expect(prepared.code).toBe("VALIDATION_ERROR");
  });

  it("unbinds a bot and keeps the bot", async () => {
    const { calls, store } = connectionStoreStub({});
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub({ imConnectionStore: store }),
      feishu: feishuStub(),
      enabled: true,
    });
    // The bot's platform is unbound through the adapter's own unbind route.
    (store as unknown as Record<string, unknown>).listViews = async () => [
      {
        connection: connectionRecord({ channel: "feishu" }),
        state: "bound",
        binding: {
          bindingId: "binding_1",
          connectionId: "connection_1",
          channel: "feishu",
          clientName: "mavis",
          createdAt: 1,
          updatedAt: 2,
        },
      },
    ];

    const outcome = await surface.disconnectConnection({ connectionId: "connection_1" });

    expect(outcome).toEqual({ ok: true });
    expect(calls.deleteBinding).toEqual(["connection_1"]);
  });

  it("deletes a bot after tearing its platform side down", async () => {
    const { calls, store } = connectionStoreStub({
      snapshot: {
        connection: connectionRecord(),
        binding: {
          bindingId: "binding_1",
          connectionId: "connection_1",
          channel: "wechat",
          clientName: "wechat:mavis",
          createdAt: 1,
          updatedAt: 2,
        },
      },
    });
    const unbound: string[] = [];
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub({ imConnectionStore: store }),
      wechat: {
        unbind: async (request: Request) => {
          unbound.push(await request.text());
          return new Response(JSON.stringify({ ok: true, unbound: true }), {
            headers: { "content-type": "application/json" },
          });
        },
      } as never,
      enabled: true,
    });

    const outcome = await surface.deleteConnection({ connectionId: "connection_1" });

    expect(outcome).toEqual({ ok: true });
    expect(calls.deleteConnection).toEqual(["connection_1"]);
    expect(unbound).toHaveLength(1);
    expect(JSON.parse(unbound[0])).toEqual({ agentName: "mavis" });
  });

  it("reports a bot the store did not delete as a refusal", async () => {
    const { store } = connectionStoreStub({ deleted: false });
    const surface = createLocalChannelBridgeSurface({
      infra: infraStub({ imConnectionStore: store }),
      enabled: true,
    });

    const outcome = await surface.deleteConnection({ connectionId: "connection_missing" });

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("No IM bot was stored");
  });
});
