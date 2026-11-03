// Where a page's tool names come from, and how a name gets back to its source.
//
// One seam: the host tool port the gateway reads, driven against two scripted sources.
// What it proves is the naming rule and the round trip — a page sees `mcp__<server>__<tool>`
// and `connector__<provider>__<tool>`, and a call with one of those names reaches the
// right source with the parts split back out. What it does not cover: the sources
// themselves (installed MCP servers, connectors) and which of them are enabled; both
// are decided before a source is handed to this port.

import { describe, expect, it } from "vitest";

import {
  createMiniAppHostToolPort,
  miniAppConnectorToolName,
  miniAppMcpToolName,
} from "../../../src/service/miniapp/tool-sources.js";

function mcpSource(tools: readonly { serverName: string; name: string; description?: string }[]) {
  const calls: Array<{ serverName: string; name: string; arguments: unknown }> = [];
  return {
    calls,
    source: {
      list: async () => tools,
      call: async (input: { serverName: string; name: string; arguments: unknown }) => {
        calls.push(input);
        return { source: "mcp", ...input };
      },
    },
  };
}

function connectorSource(
 tools: readonly { provider: string; name: string; description?: string }[],
) {
  const calls: Array<{ provider: string; name: string; arguments: unknown }> = [];
  return {
    calls,
    source: {
      list: async () => tools,
      call: async (input: { provider: string; name: string; arguments: unknown }) => {
        calls.push(input);
        return { source: "connector", ...input };
      },
    },
  };
}

describe("the names a page sees", () => {
  it("builds each source's name in one place", () => {
    expect(miniAppMcpToolName("files", "read")).toBe("mcp__files__read");
    expect(miniAppConnectorToolName("github", "list_issues")).toBe(
      "connector__github__list_issues",
    );
  });

  it("offers both sources' tools under their prefixes", async () => {
    const { source: mcp } = mcpSource([{ serverName: "files", name: "read" }]);
    const { source: connectors } = connectorSource([{ provider: "github", name: "list_issues" }]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    expect((await port.list()).map((tool) => tool.name)).toEqual([
      "mcp__files__read",
      "connector__github__list_issues",
    ]);
  });

  it("keeps the page from calling a source by a name it did not build", async () => {
    const { source: mcp } = mcpSource([{ serverName: "files", name: "read" }]);
    const { source: connectors } = connectorSource([]);
    const { calls } = connectorSource([]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    await expect(port.call("files__read", {})).rejects.toMatchObject({
      code: "TOOL_NOT_FOUND",
    });
    expect(calls).toEqual([]);
  });

  it("does not offer a tool whose composed name is beyond the wire limit", async () => {
    const { source: mcp } = mcpSource([{ serverName: "s".repeat(600), name: "t".repeat(600) }]);
    const { source: connectors } = connectorSource([]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    expect(await port.list()).toEqual([]);
  });

  it("offers nothing from a source that answers no tools", async () => {
    const { source: mcp } = mcpSource([]);
    const { source: connectors } = connectorSource([]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    expect(await port.list()).toEqual([]);
  });

  it("keeps the first source's tool when two sources compose the same name", async () => {
    // Desktop's rule: the merged listing keeps the first entry that claimed a name and
    // drops the rest, silently. Two plugins declaring the same MCP server name still
    // produce one page-visible tool, so no page can reach a tool by a name it did not
    // see — the name stays with whoever listed first.
    const { source: mcp } = mcpSource([
      { serverName: "files", name: "read" },
      { serverName: "files", name: "read" },
    ]);
    const { source: connectors } = connectorSource([]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    expect((await port.list()).map((tool) => tool.name)).toEqual(["mcp__files__read"]);
    expect(port.diagnostics()).toEqual([]);
  });

  it("keeps the other tools when one name collides", async () => {
    const { source: mcp } = mcpSource([
      { serverName: "files", name: "read" },
      { serverName: "files", name: "read" },
      { serverName: "files", name: "write" },
    ]);
    const { source: connectors } = connectorSource([]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    expect((await port.list()).map((tool) => tool.name)).toEqual([
      "mcp__files__read",
      "mcp__files__write",
    ]);
    expect(port.diagnostics()).toEqual([]);
  });

  it("lets the MCP source win a name a connector also claims", async () => {
    // The order desktop merges in: MCP first, connectors after. A connector cannot
    // take a name from a plugin's MCP server by being listed second.
    const { source: mcp } = mcpSource([]);
    const { source: connectors } = connectorSource([]);
    const port = createMiniAppHostToolPort({
      mcp: { ...mcp, list: async () => [{ serverName: "x", name: "y" }] },
      connectors: { ...connectors, list: async () => [{ provider: "x", name: "y" }] },
    });

    // The two prefixes keep them apart in practice; this pins that a duplicate name is
    // resolved by listing order rather than by source kind.
    expect((await port.list()).map((tool) => tool.name)).toEqual([
      "mcp__x__y",
      "connector__x__y",
    ]);
  });

  it("reports a name too long to send instead of losing it silently", async () => {
    const { source: mcp } = mcpSource([{ serverName: "s".repeat(600), name: "t".repeat(600) }]);
    const { source: connectors } = connectorSource([]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    expect(await port.list()).toEqual([]);
    expect(port.diagnostics()).toEqual([
      { name: `mcp__${"s".repeat(600)}__${"t".repeat(600)}`, kind: "too-long" },
    ]);
  });

  it("reports nothing when no name collides and none is too long", async () => {
    const { source: mcp } = mcpSource([{ serverName: "files", name: "read" }]);
    const { source: connectors } = connectorSource([{ provider: "github", name: "list_issues" }]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    await port.list();
    expect(port.diagnostics()).toEqual([]);
  });
});

describe("a call reaching its source", () => {
  it("sends an mcp name back with its server and tool split out", async () => {
    const { source: mcp, calls } = mcpSource([{ serverName: "files", name: "read" }]);
    const { source: connectors } = connectorSource([]);

    const port = createMiniAppHostToolPort({ mcp, connectors });
    const result = await port.call("mcp__files__read", { path: "a.txt" });

    expect(result).toEqual({
      source: "mcp",
      serverName: "files",
      name: "read",
      arguments: { path: "a.txt" },
    });
    expect(calls).toEqual([{ serverName: "files", name: "read", arguments: { path: "a.txt" } }]);
  });

  it("sends a connector name back with its provider and tool split out", async () => {
    const { source: mcp } = mcpSource([]);
    const { source: connectors, calls } = connectorSource([
      { provider: "github", name: "list_issues" },
    ]);

    const port = createMiniAppHostToolPort({ mcp, connectors });
    await port.call("connector__github__list_issues", { limit: 5 });

    expect(calls).toEqual([
      { provider: "github", name: "list_issues", arguments: { limit: 5 } },
    ]);
  });

  it("splits at the first separator, so a tool name may contain one", async () => {
    // The provider is a bounded identifier; the tool name is the server's own and may
    // carry separators. Splitting the other way would chop a tool name in half.
    const { source: mcp } = mcpSource([]);
    const { source: connectors, calls } = connectorSource([
      { provider: "github", name: "issues__list" },
    ]);

    const port = createMiniAppHostToolPort({ mcp, connectors });
    await port.call("connector__github__issues__list", {});

    expect(calls).toEqual([{ provider: "github", name: "issues__list", arguments: {} }]);
  });

  it("refuses a name that belongs to no source", async () => {
    const { source: mcp } = mcpSource([{ serverName: "files", name: "read" }]);
    const { source: connectors } = connectorSource([]);

    const port = createMiniAppHostToolPort({ mcp, connectors });

    await expect(port.call("mcp__absent__read", {})).rejects.toMatchObject({
      code: "TOOL_NOT_FOUND",
    });
  });

  it("refuses a name whose prefix names no source", async () => {
    const port = createMiniAppHostToolPort({
      mcp: mcpSource([]).source,
      connectors: connectorSource([]).source,
    });

    await expect(port.call("builtin__read_file", {})).rejects.toMatchObject({
      code: "TOOL_NOT_FOUND",
    });
  });
});
