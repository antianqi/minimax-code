// The MCP half of a page's tool list: which servers answer, and calls through them.
//
// One seam: the source adapter over a host-level MCP lister/caller, driven against a
// scripted pair. What it proves is that the servers the Host currently serves are the
// ones a page sees, that a call reaches the server the name came from, and that a
// server which stopped answering between listing and call is refused instead of being
// quietly retried. What it does not cover: which servers the Host serves (the plugin
// snapshot decides, and that join is wiring), and the naming a page sees —
// `mcp__<server>__<tool>` is composed in `tool-sources.ts`.

import { describe, expect, it } from "vitest";

import { createMiniAppMcpToolSource } from "../../../src/service/miniapp/tool-source-mcp.js";

function host(servers: Record<string, readonly { name: string; description?: string }[]>) {
  let serving = Object.keys(servers);
  const listed: string[] = [];
  const called: Array<{ serverName: string; name: string; arguments: unknown }> = [];
  return {
    listed,
    called,
    serve: (names: readonly string[]) => {
      serving = [...names];
    },
    port: {
      servers: () => serving,
      listTools: async (serverName: string) => {
        listed.push(serverName);
        return servers[serverName] ?? [];
      },
      callTool: async (input: {
        serverName: string;
        name: string;
        arguments: unknown;
      }) => {
        called.push(input);
        return { content: [{ type: "text", text: "ok" }] };
      },
    },
  };
}

describe("the MCP tools a page sees", () => {
  it("lists every served server's tools under that server", async () => {
    const fake = host({
      files: [{ name: "read", description: "读取文件" }, { name: "write" }],
      search: [{ name: "query" }],
    });
    const source = createMiniAppMcpToolSource({ host: fake.port });

    expect(await source.list()).toEqual([
      { serverName: "files", name: "read", description: "读取文件" },
      { serverName: "files", name: "write" },
      { serverName: "search", name: "query" },
    ]);
  });

  it("reads which servers are served on every listing", async () => {
    const fake = host({ files: [{ name: "read" }], search: [{ name: "query" }] });
    const source = createMiniAppMcpToolSource({ host: fake.port });

    expect(await source.list()).toHaveLength(2);
    fake.serve(["files"]);
    expect(await source.list()).toEqual([{ serverName: "files", name: "read" }]);
  });

  it("offers nothing when the Host serves no server", async () => {
    const fake = host({});
    const source = createMiniAppMcpToolSource({ host: fake.port });

    expect(await source.list()).toEqual([]);
    // No server to ask, so nothing is asked.
    expect(fake.listed).toEqual([]);
  });

  it("does not let one failing server hide the others", async () => {
    const fake = host({ files: [{ name: "read" }], broken: [] });
    const source = createMiniAppMcpToolSource({
      host: {
        ...fake.port,
        listTools: async (serverName: string) => {
          if (serverName === "broken") throw new Error("server went away");
          return [{ name: "read" }];
        },
      },
    });
    void fake;

    expect(await source.list()).toEqual([{ serverName: "files", name: "read" }]);
  });

  it("passes a name two servers both report through, so the collision is visible", async () => {
    // Two plugins declaring the same server name produce this. Deduplicating here would
    // hide one tool behind the other; the layer that composes page-visible names is the
    // one that can withdraw the name and report it.
    const source = createMiniAppMcpToolSource({
      host: {
        servers: () => ["files", "files"],
        listTools: async () => [{ name: "read" }],
        callTool: async () => undefined,
      },
    });

    expect(await source.list()).toEqual([
      { serverName: "files", name: "read" },
      { serverName: "files", name: "read" },
    ]);
  });
});

describe("an MCP call from a page", () => {
  it("reaches the server the name came from", async () => {
    const fake = host({ files: [{ name: "read" }], search: [{ name: "query" }] });
    const source = createMiniAppMcpToolSource({ host: fake.port });
    await source.list();

    await source.call({ serverName: "search", name: "query", arguments: { q: "x" } });

    expect(fake.called).toEqual([{ serverName: "search", name: "query", arguments: { q: "x" } }]);
  });

  it("refuses a server that stopped being served after the listing", async () => {
    const fake = host({ files: [{ name: "read" }] });
    const source = createMiniAppMcpToolSource({ host: fake.port });
    await source.list();
    fake.serve([]);

    await expect(
      source.call({ serverName: "files", name: "read", arguments: {} }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED" });
    expect(fake.called).toEqual([]);
  });

  it("refuses a tool the server does not offer, without dispatching it", async () => {
    const fake = host({ files: [{ name: "read" }] });
    const source = createMiniAppMcpToolSource({ host: fake.port });

    await expect(
      source.call({ serverName: "files", name: "absent", arguments: {} }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });
    expect(fake.called).toEqual([]);
  });
});
