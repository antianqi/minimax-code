// The gate a Mini App's page meets before it can reach a host tool.
//
// One seam: the gateway's session, driven against a scripted host-tool port. What it
// proves is the answer the page gets — which tools are offered, and which calls are
// dispatched — under the two conditions that have to hold together: the package
// declared `toolAccess: ['call']`, and the person left `tool:call` on. What it does
// not cover: the page-side bridge that reaches this gateway, the tool sources behind
// the port (MCP servers, connectors), and the approval prompt an `ask` rule raises.
// Those live in their own slices.

import { describe, expect, it } from "vitest";

import { createMiniAppToolGateway } from "../../../src/service/miniapp/tool-gateway.js";
import { createMiniAppHostToolPort } from "../../../src/service/miniapp/tool-sources.js";

const CALLER = { pluginId: "pet", processGeneration: "gen-1" };

function hostTools(names: readonly string[] = ["mcp__files__read", "connector__github__list"]) {
  const calls: Array<{ name: string; input: unknown }> = [];
  return {
    calls,
    port: {
      list: async () => names.map((name) => ({ name, description: `${name} 描述` })),
      call: async (name: string, input: unknown) => {
        calls.push({ name, input });
        return { content: [{ type: "text", text: "ok" }] };
      },
    },
  };
}

function switches(on: boolean) {
  return { isEnabled: () => on };
}

/** The rules say yes: without a rule answer every call is `ask`, and an `ask` with
 * nobody to answer it is refused — so a test about dispatch has to state the rule. */
function allowed() {
  return {
    snapshot: async () => ({ check: () => "allow" as const }),
    allowAlways: async () => undefined,
  };
}

describe("the Mini App tool gateway", () => {
  it("offers the host's tools to a package that declared call, with the switch on", async () => {
    const { port } = hostTools();
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
    });

    const session = gateway.open(CALLER);

    expect((await session.list()).map((entry) => entry.name)).toEqual([
      "mcp__files__read",
      "connector__github__list",
    ]);
  });

  it("dispatches a call it offers", async () => {
    const { port, calls } = hostTools();
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
      permissions: allowed(),
    });

    const result = await gateway.open(CALLER).call("mcp__files__read", { path: "a.txt" });

    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(calls).toEqual([{ name: "mcp__files__read", input: { path: "a.txt" } }]);
  });

  it("lists the tools with every rule denied once tool:call is off", async () => {
    // Desktop's answer, and the one a page can render: the tools exist and are switched
    // off, which is a different thing from "this app has no tools".
    const { port, calls } = hostTools();
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(false),
      declaresToolAccess: () => true,
      permissions: allowed(),
    });

    const session = gateway.open(CALLER);

    expect((await session.list()).map(({ name, decision }) => [name, decision])).toEqual([
      ["mcp__files__read", "deny"],
      ["connector__github__list", "deny"],
    ]);
    await expect(session.call("mcp__files__read", {})).rejects.toMatchObject({
      code: "TOOL_NOT_PERMITTED",
      disposition: "not_dispatched",
    });
    expect(calls).toEqual([]);
  });

  it("denies a package that never declared tool access, whatever the switch says", async () => {
    const { port, calls } = hostTools();
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => false,
    });

    const session = gateway.open(CALLER);

    expect((await session.list()).map((entry) => entry.decision)).toEqual(["deny", "deny"]);
    await expect(session.call("mcp__files__read", {})).rejects.toMatchObject({
      code: "TOOL_NOT_PERMITTED",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a name it does not serve without dispatching", async () => {
    const { port, calls } = hostTools();
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
    });

    await expect(gateway.open(CALLER).call("mcp__absent__write", {})).rejects.toMatchObject({
      code: "TOOL_NOT_FOUND",
      disposition: "not_dispatched",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a name beyond the wire limit before asking the host", async () => {
    const { port, calls } = hostTools();
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
    });

    await expect(gateway.open(CALLER).call("x".repeat(1025), {})).rejects.toMatchObject({
      code: "INVALID_ARGUMENTS",
      disposition: "not_dispatched",
    });
    expect(calls).toEqual([]);
  });

  it("keeps the switch read per call, so turning it off takes effect without a restart", async () => {
    const { port, calls } = hostTools();
    let on = true;
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: { isEnabled: () => on },
      declaresToolAccess: () => true,
      permissions: allowed(),
    });
    const session = gateway.open(CALLER);

    await session.call("mcp__files__read", { first: true });
    on = false;

    await expect(session.call("mcp__files__read", { second: true })).rejects.toMatchObject({
      code: "TOOL_NOT_PERMITTED",
    });
    expect(calls).toEqual([{ name: "mcp__files__read", input: { first: true } }]);
  });
});

describe("the rules a Mini App's tool call meets", () => {
  const rules = (verdict: "allow" | "ask" | "deny") => ({
    snapshot: async () => ({ check: () => verdict }),
    allowAlways: async () => undefined,
  });

  it("shows each tool's rule in the listing", async () => {
    const { port } = hostTools(["mcp__files__read", "mcp__files__write"]);
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
      permissions: {
        snapshot: async () => ({
          check: (name: string) => (name === "mcp__files__read" ? "allow" : "deny"),
        }),
        allowAlways: async () => undefined,
      },
    });

    const listing = await gateway.open(CALLER).list();

    expect(listing.map((entry) => [entry.name, entry.decision])).toEqual([
      ["mcp__files__read", "allow"],
      ["mcp__files__write", "deny"],
    ]);
  });

  it("refuses a tool the rules deny, without dispatching it", async () => {
    const { port, calls } = hostTools();
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
      permissions: rules("deny"),
    });

    await expect(gateway.open(CALLER).call("mcp__files__read", {})).rejects.toMatchObject({
      code: "TOOL_NOT_PERMITTED",
      disposition: "not_dispatched",
    });
    expect(calls).toEqual([]);
  });

  it("dispatches a tool the person approved when the rule asked", async () => {
    const { port, calls } = hostTools();
    const asked: unknown[] = [];
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
      permissions: rules("ask"),
      approvals: {
        request: async (request) => {
          asked.push(request);
          return { decision: "allow" };
        },
      },
    });

    await gateway.open(CALLER).call("mcp__files__read", { path: "a.txt" });

    expect(asked).toHaveLength(1);
    expect(calls).toEqual([{ name: "mcp__files__read", input: { path: "a.txt" } }]);
  });

  it("refuses an ask nobody can answer, without dispatching it", async () => {
    const { port, calls } = hostTools();
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
      permissions: rules("ask"),
    });

    await expect(gateway.open(CALLER).call("mcp__files__read", {})).rejects.toMatchObject({
      code: "TOOL_APPROVAL_REQUIRED",
      disposition: "not_dispatched",
    });
    expect(calls).toEqual([]);
  });
});

describe("a page's path to a tool it may use", () => {
  it("goes switch → rules → source, and the source sees the split name", async () => {
    // The three pieces together, which none of their own tests prove: the gateway's
    // gate, the rule step, and the source adapter that owns the naming.
    const { source, calls } = (() => {
      const calls: Array<{ serverName: string; name: string; arguments: unknown }> = [];
      return {
        calls,
        source: {
          list: async () => [{ serverName: "files", name: "read" }],
          call: async (input: { serverName: string; name: string; arguments: unknown }) => {
            calls.push(input);
            return { content: [{ type: "text", text: "ok" }] };
          },
        },
      };
    })();

    const gateway = createMiniAppToolGateway({
      tools: createMiniAppHostToolPort({ mcp: source }),
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
      permissions: allowed(),
    });

    const session = gateway.open(CALLER);
    expect(await session.list()).toEqual([
      { name: "mcp__files__read", decision: "allow" },
    ]);

    await expect(session.call("mcp__files__read", { path: "a.txt" })).resolves.toEqual({
      content: [{ type: "text", text: "ok" }],
    });
    expect(calls).toEqual([{ serverName: "files", name: "read", arguments: { path: "a.txt" } }]);
  });
});

describe("the audit a page's call leaves behind", () => {
  it("records the attempt and then the result, in that order", async () => {
    const events: Array<Record<string, unknown>> = [];
    const { port, calls } = hostTools(["mcp__files__read"]);
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
      permissions: allowed(),
      audit: { record: (event) => void events.push({ ...event }) },
    });

    await gateway.open(CALLER).call("mcp__files__read", { path: "a" });

    // Two records, not one: an attempt that never dispatches must be visible as a
    // refusal, and an attempt that dispatches must be visible as having done so.
    expect(events.map((event) => event.action)).toEqual(["call", "result"]);
    expect(events[0]).toMatchObject({
      action: "call",
      pluginId: "pet",
      processGeneration: "gen-1",
      name: "mcp__files__read",
    });
    expect(events[1]).toMatchObject({ action: "result", outcome: "dispatched" });
    expect(calls).toHaveLength(1);
  });

  it("records a refusal with the code, and dispatches nothing", async () => {
    const events: Array<Record<string, unknown>> = [];
    const { port, calls } = hostTools(["mcp__files__read"]);
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(false),
      declaresToolAccess: () => true,
      permissions: allowed(),
      audit: { record: (event) => void events.push({ ...event }) },
    });

    await expect(gateway.open(CALLER).call("mcp__files__read", {})).rejects.toMatchObject({
      code: "TOOL_NOT_PERMITTED",
    });

    expect(events.map((event) => event.action)).toEqual(["call", "result"]);
    expect(events[1]).toMatchObject({
      action: "result",
      outcome: "not_dispatched",
      code: "TOOL_NOT_PERMITTED",
    });
    expect(calls).toEqual([]);
  });

  it("survives an audit that throws, because audit is a record and not a gate", async () => {
    const { port, calls } = hostTools(["mcp__files__read"]);
    const gateway = createMiniAppToolGateway({
      tools: port,
      permissionSwitches: switches(true),
      declaresToolAccess: () => true,
      permissions: allowed(),
      audit: {
        record: () => {
          throw new Error("logger is down");
        },
      },
    });

    await expect(gateway.open(CALLER).call("mcp__files__read", {})).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
  });
});
