// What a page's three tool methods mean, as the host answers them.
//
// One seam: `createMiniAppToolSessions(...).run(...)`, driven against a scripted
// gateway session. What it proves is the mapping the request methods are: a listing
// carries rules, a request carries the state of every tool it named plus whether a
// person was reachable, and a call carries the tool's own result. What it does not
// cover: the gateway's own gate (its tests), and the wire that carries these answers to
// a page.

import { describe, expect, it } from "vitest";

import { createMiniAppToolSessions } from "../../../src/service/miniapp/tool-sessions.js";
import type { MiniAppToolGateway, MiniAppToolSession } from "../../../src/service/miniapp/tool-gateway.js";

function gateway(session: Partial<MiniAppToolSession>) {
  const opened: string[] = [];
  const full: MiniAppToolSession = {
    list: async () => [],
    call: async () => undefined,
    ...session,
  };
  const factory = (): MiniAppToolGateway => ({
    open: (caller) => {
      opened.push(caller.pluginId);
      return full;
    },
  });
  return { factory, opened };
}

const rules = (verdict: "allow" | "ask" | "deny") => ({
  snapshot: async () => ({ check: () => verdict }),
  allowAlways: async () => undefined,
});

describe("a page's tool listing", () => {
  it("answers the tools with the rules they meet", async () => {
    const { factory } = gateway({
      list: async () => [
        { name: "mcp__files__read", decision: "allow" },
        { name: "connector__github__list", decision: "ask", description: "列出 issue" },
      ],
    });
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: factory,
    });

    expect(await sessions.run({ pluginId: "pet", method: "list" })).toEqual({
      tools: [
        { name: "mcp__files__read", decision: "allow" },
        { name: "connector__github__list", decision: "ask", description: "列出 issue" },
      ],
    });
  });
});

describe("a page asking for approval", () => {
  it("answers the state of every tool it named, and that nobody could be asked", async () => {
    const { factory } = gateway({});
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: factory,
      permissions: rules("ask"),
    });

    expect(
      await sessions.run({
        pluginId: "pet",
        method: "request",
        names: ["mcp__files__read", "mcp__files__write"],
      }),
    ).toEqual({
      permissions: { "mcp__files__read": "ask", "mcp__files__write": "ask" },
      approvalRequired: true,
    });
  });

  it("writes a rule for the tools the person ticked, and none for the rest", async () => {
    const written: string[] = [];
    const { factory } = gateway({});
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: factory,
      permissions: {
        snapshot: async () => ({ check: () => "ask" }),
        allowAlways: async (name: string) => {
          written.push(name);
        },
      },
      approvals: { request: async () => ({ decision: "allowAlways", names: ["b"] }) },
    });

    await sessions.run({ pluginId: "pet", method: "request", names: ["a", "b"] });

    expect(written).toEqual(["b"]);
  });
});

describe("a page calling one tool", () => {
  it("relays the tool's own result", async () => {
    const { factory } = gateway({
      call: async (name: string) => ({ content: [{ type: "text", text: name }] }),
    });
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: factory,
    });

    expect(
      await sessions.run({ pluginId: "pet", method: "call", name: "mcp__files__read", arguments: {} }),
    ).toEqual({ value: { content: [{ type: "text", text: "mcp__files__read" }] } });
  });

  it("passes the gateway's refusal on as it is", async () => {
    const { factory } = gateway({
      call: async () => {
        throw Object.assign(new Error("Mini App tool call is not permitted"), {
          code: "TOOL_NOT_PERMITTED",
        });
      },
    });
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: factory,
    });

    await expect(
      sessions.run({ pluginId: "pet", method: "call", name: "mcp__files__read", arguments: {} }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED" });
  });

  it("refuses a call with no tool name instead of calling undefined", async () => {
    const called: unknown[] = [];
    const { factory } = gateway({
      call: async (name: string) => {
        called.push(name);
        return undefined;
      },
    });
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: factory,
    });

    await expect(sessions.run({ pluginId: "pet", method: "call" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
    });
    expect(called).toEqual([]);
  });
});

describe("the declaration a session is built with", () => {
  it("is resolved once per plugin, not once per call", async () => {
    let reads = 0;
    const { factory, opened } = gateway({});
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: async () => {
        reads += 1;
        return true;
      },
      createGateway: factory,
    });

    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });
    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });
    await sessions.run({ pluginId: "other", method: "list", processGeneration: "gen-1" });

    expect(reads).toBe(2);
    expect(opened).toEqual(["pet", "other"]);
  });
});

describe("the generation a session belongs to", () => {
  it("travels to the gateway, because a tool port is bound to one process generation", async () => {
    const callers: Array<{ pluginId: string; processGeneration?: string }> = [];
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: () => ({
        open: (caller) => {
          callers.push(caller);
          return { list: async () => [], call: async () => undefined };
        },
      }),
    });

    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });

    expect(callers).toEqual([{ pluginId: "pet", processGeneration: "gen-1" }]);
  });

  it("is reused while it lasts", async () => {
    const callers: unknown[] = [];
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: () => ({
        open: (caller) => {
          callers.push(caller);
          return { list: async () => [], call: async () => undefined };
        },
      }),
    });

    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });
    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });

    expect(callers).toHaveLength(1);
  });

  it("is dropped when the app restarts, so a dead generation keeps no session", async () => {
    const callers: unknown[] = [];
    const sessions = createMiniAppToolSessions({
      tools: () => ({ list: async () => [], call: async () => undefined }),
      declaresToolAccess: () => true,
      createGateway: () => ({
        open: (caller) => {
          callers.push(caller);
          return { list: async () => [], call: async () => undefined };
        },
      }),
    });

    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });
    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-2" });
    // Back to the old generation is a new session, not the one gen-2 replaced: a
    // generation that ended is over, and its session would point at a dead process.
    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });

    expect(callers).toEqual([
      { pluginId: "pet", processGeneration: "gen-1" },
      { pluginId: "pet", processGeneration: "gen-2" },
      { pluginId: "pet", processGeneration: "gen-1" },
    ]);
  });
});

describe("the tool port a session is built with", () => {
  it("is built for the caller that opened it, so a restarted app reaches its own process", async () => {
    const built: Array<string | undefined> = [];
    const asked: Array<string | undefined> = [];
    const sessions = createMiniAppToolSessions({
      tools: (caller) => {
        built.push(caller.processGeneration);
        return {
          list: async () => {
            asked.push(caller.processGeneration);
            return [];
          },
          call: async () => undefined,
        };
      },
      declaresToolAccess: () => true,
      createGateway: (options) => ({
        open: () => ({ list: () => options.tools.list(), call: async () => undefined }),
      }),
    });

    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });
    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-1" });
    await sessions.run({ pluginId: "pet", method: "list", processGeneration: "gen-2" });

    // One port per session, not one per call: the port is what a caller reaches the
    // Host through, and a caller is a generation.
    expect(built).toEqual(["gen-1", "gen-2"]);
    expect(asked).toEqual(["gen-1", "gen-1", "gen-2"]);
  });
});
