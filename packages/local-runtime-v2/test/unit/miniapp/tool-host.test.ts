// The Host's tool channel, built once for the whole process.
//
// One seam: `createMiniAppToolHost(...)` as the runtime assembles it — the answer to
// "what does a page see and where does a call land". What it proves: the two sources
// are merged into one flat list; a connector call is made as the caller that asked,
// so the generation a page belongs to is the generation the connector gateway
// registers; and a caller without a generation reaches no connector, because there is
// no process to register it against. What it does not cover: the sources themselves
// (their own tests) and the wire that carries these answers to a page.

import { describe, expect, it } from "vitest";

import { createMiniAppToolHost } from "../../../src/service/miniapp/tool-host.js";
import { composeMiniAppToolHost } from "../../../src/service/miniapp/composition.js";
import type { MiniAppConnectorGatewayPort } from "../../../src/service/miniapp/tool-source-connector.js";

interface ConnectorCall {
  readonly handle: string;
  readonly caller: { kind: string; pluginId: string; processGeneration: string };
}

function connectors() {
  const listed: Array<{ allowlist: readonly string[] | "all"; caller: unknown }> = [];
  const called: ConnectorCall[] = [];
  const gateway: MiniAppConnectorGatewayPort = {
    list: async (input) => {
      listed.push({ allowlist: input.providerAllowlist, caller: input.caller });
      return {
        tools: [
          {
            handle: "h-1",
            provider: "github",
            providerToolName: "list_issues",
            description: "列出 issue",
          },
        ],
        partial: false,
      };
    },
    call: async (input) => {
      called.push({
        handle: input.handle,
        caller: input.caller as ConnectorCall["caller"],
      });
      return { content: [{ type: "text", text: "ok" }] };
    },
  };
  return { gateway, listed, called };
}

function mcp() {
  return {
    servers: () => ["files"],
    listTools: async () => [{ name: "read", description: "读取文件" }],
    callTool: async (input: { name: string }) => ({ content: input.name }),
  };
}

describe("the Host's tool channel", () => {
  it("offers a page one flat list of the MCP and connector tools it serves", async () => {
    const { gateway } = connectors();
    const host = createMiniAppToolHost({
      mcp: mcp(),
      connectorGateway: gateway,
      declaresToolAccess: () => true,
    });

    expect(await host.run({ pluginId: "pet", processGeneration: "gen-1", method: "list" })).toEqual({
      tools: [
        { name: "mcp__files__read", description: "读取文件", decision: "ask" },
        { name: "connector__github__list_issues", description: "列出 issue", decision: "ask" },
      ],
    });
  });

  it("calls a connector as the page's own plugin and generation", async () => {
    const { gateway, called } = connectors();
    const host = createMiniAppToolHost({
      mcp: mcp(),
      connectorGateway: gateway,
      declaresToolAccess: () => true,
      permissions: { snapshot: async () => ({ check: () => "allow" }), allowAlways: () => undefined },
    });

    await host.run({
      pluginId: "pet",
      processGeneration: "gen-2",
      method: "call",
      name: "connector__github__list_issues",
      arguments: { state: "open" },
    });

    expect(called).toEqual([
      {
        handle: "h-1",
        caller: { kind: "host-process", pluginId: "pet", processGeneration: "gen-2" },
      },
    ]);
  });

  it("reaches no connector for a caller with no generation, and says so by omission", async () => {
    const { gateway, listed } = connectors();
    const host = createMiniAppToolHost({
      mcp: mcp(),
      connectorGateway: gateway,
      declaresToolAccess: () => true,
    });

    const listing = await host.run({ pluginId: "pet", method: "list" });

    expect(listing).toEqual({
      tools: [{ name: "mcp__files__read", description: "读取文件", decision: "ask" }],
    });
    // A connector inventory asked for without a process to register would be an
    // inventory the gateway cannot attribute, so it is not asked for at all.
    expect(listed).toEqual([]);
  });

  it("closes the channel when the package declares no tool access", async () => {
    const { gateway } = connectors();
    const host = createMiniAppToolHost({
      connectorGateway: gateway,
      declaresToolAccess: () => false,
    });

    // The listing still names what the package could reach, with every rule denied:
    // a page that is told "nothing here" cannot tell "no tools" from "not allowed".
    expect(await host.run({ pluginId: "pet", processGeneration: "gen-1", method: "list" })).toEqual({
      tools: [
        { name: "connector__github__list_issues", description: "列出 issue", decision: "deny" },
      ],
    });
  });

  it("is the same channel for a second generation, with a port built for it", async () => {
    const { gateway, called } = connectors();
    const host = createMiniAppToolHost({
      connectorGateway: gateway,
      declaresToolAccess: () => true,
      permissions: { snapshot: async () => ({ check: () => "allow" }), allowAlways: () => undefined },
    });

    await host.run({
      pluginId: "pet",
      processGeneration: "gen-1",
      method: "call",
      name: "connector__github__list_issues",
      arguments: {},
    });
    await host.run({
      pluginId: "pet",
      processGeneration: "gen-2",
      method: "call",
      name: "connector__github__list_issues",
      arguments: {},
    });

    expect(called.map((entry) => entry.caller.processGeneration)).toEqual(["gen-1", "gen-2"]);
  });
});

describe("assembling the channel at the composition boundary", () => {
  it("is built when the Host serves MCP tools, and reads the declaration from the package", async () => {
    const host = composeMiniAppToolHost({
      hostConnectorGateway: connectors().gateway,
      miniAppMcp: {
        servers: () => ["files"],
        listTools: async () => [{ name: "read", description: "读取文件" }],
        callTool: async () => ({}),
      },
      declaresMiniAppToolAccess: async () => true,
    });

    expect(host).toBeDefined();
    expect(await host?.run({ pluginId: "pet", processGeneration: "gen-1", method: "list" })).toEqual({
      tools: [
        { name: "mcp__files__read", description: "读取文件", decision: "ask" },
        { name: "connector__github__list_issues", description: "列出 issue", decision: "ask" },
      ],
    });
  });

  it("is absent when the Host serves no MCP tools, so a page is never told about a channel it lacks", () => {
    expect(
      composeMiniAppToolHost({
        hostConnectorGateway: connectors().gateway,
        declaresMiniAppToolAccess: async () => true,
      }),
    ).toBeUndefined();
  });
});
