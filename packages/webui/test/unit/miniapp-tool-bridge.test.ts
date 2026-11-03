// The tool channel a page reaches: `window.mcode.miniapp.tools.*`.
//
// Two seams, one criterion each. The script half proves what a page can ask for and in
// what shape the request leaves it: a method name, the tool names it is about, and a
// correlation id — never a plugin, a session or a permission, because the page knows no
// identity. The host half proves that a request the page should not be able to make is
// refused before anything is dispatched, and that a host without the tool capability
// says so instead of answering an empty list.

import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";

import { miniAppPageBridge } from "../../src/server/miniapp/bridge.js";
import {
  webuiMiniAppToolAnswer,
  webuiMiniAppToolRequest,
} from "../../src/client/features/miniapp/application/miniapp-tool-bridge.js";
import {
  WEBUI_MINIAPP_TOOL_MAX_NAMES,
  WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
  WEBUI_MINIAPP_BRIDGE_TOOL_RESULT,
} from "../../src/shared/contracts/miniapp-tools.js";

function page() {
  const posted: unknown[] = [];
  // The script registers one listener per channel it serves, so the harness has to keep
  // them all: keeping only the last one silently disables every channel registered before
  // it, which turns a passing test into a five-second timeout.
  const listeners: Array<(event: unknown) => void> = [];
  const window = {
    mcode: {},
    parent: { postMessage: (data: unknown) => posted.push(data) },
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      if (name === "message") listeners.push(handler);
    },
  };
  runInNewContext(miniAppPageBridge().script, {
    window,
    Map,
    Math,
    Date,
    Promise,
    Error,
  });
  const tools = (
    window.mcode as {
      miniapp: {
        tools: {
          list(): Promise<unknown>;
          request(names: unknown): Promise<unknown>;
          call(name: unknown, input: unknown): Promise<unknown>;
        };
      };
    }
  ).miniapp.tools;
  return {
    posted,
    tools,
    answer: (data: unknown) => {
      for (const listener of listeners) listener({ source: window.parent, data });
    },
  };
}

describe("the tools a page can ask for", () => {
  it("announces the three tool methods as capabilities", () => {
    const window = { mcode: {}, parent: {}, addEventListener: vi.fn() };
    runInNewContext(miniAppPageBridge().script, { window, Map, Math, Date, Promise, Error });
    const has = (window.mcode as { miniapp: { capabilities: { has(name: string): boolean } } })
      .miniapp.capabilities.has;

    expect(has("tools.list")).toBe(true);
    expect(has("tools.request")).toBe(true);
    expect(has("tools.call")).toBe(true);
  });

  it("sends a listing request that names no identity", async () => {
    const { tools, posted } = page();
    void tools.list();

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
      method: "list",
    });
    // Nothing but the envelope: a page cannot name a plugin, a session or a switch.
    expect(Object.keys(posted[0] as Record<string, unknown>).sort()).toEqual([
      "method",
      "requestId",
      "type",
    ]);
  });

  it("sends a call with its tool name and arguments", async () => {
    const { tools, posted } = page();
    void tools.call("connector__github__list_issues", { limit: 3 });

    expect(posted[0]).toMatchObject({
      type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
      method: "call",
      name: "connector__github__list_issues",
      arguments: { limit: 3 },
    });
  });

  it("resolves with the result the host answers", async () => {
    const { tools, posted, answer } = page();
    const pending = tools.list();
    const requestId = (posted[0] as { requestId: string }).requestId;

    answer({
      type: WEBUI_MINIAPP_BRIDGE_TOOL_RESULT,
      requestId,
      result: { ok: true, value: { tools: [{ name: "mcp__files__read", decision: "allow" }] } },
    });

    await expect(pending).resolves.toEqual({
      tools: [{ name: "mcp__files__read", decision: "allow" }],
    });
  });

  it("rejects with the host's code when the call is refused", async () => {
    const { tools, posted, answer } = page();
    const pending = tools.call("mcp__files__read", {});
    const requestId = (posted[0] as { requestId: string }).requestId;

    answer({
      type: WEBUI_MINIAPP_BRIDGE_TOOL_RESULT,
      requestId,
      result: { ok: false, code: "TOOL_NOT_PERMITTED" },
    });

    await expect(pending).rejects.toThrow("TOOL_NOT_PERMITTED");
  });

  it("refuses a name that is not a string before sending anything", async () => {
    const { tools, posted } = page();

    await expect(tools.call(7, {})).rejects.toThrow("invalid_request");
    expect(posted).toEqual([]);
  });

  it("refuses more names than the wire allows", async () => {
    const { tools, posted } = page();
    const names = Array.from({ length: WEBUI_MINIAPP_TOOL_MAX_NAMES + 1 }, (_, index) => `t${index}`);

    await expect(tools.request(names)).rejects.toThrow("invalid_request");
    expect(posted).toEqual([]);
  });
});

describe("reading a tool request on the host", () => {
  it("accepts each method's own shape and nothing else", () => {
    expect(
      webuiMiniAppToolRequest({
        type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
        requestId: "r-1",
        method: "list",
      }),
    ).toEqual({ requestId: "r-1", method: "list" });

    expect(
      webuiMiniAppToolRequest({
        type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
        requestId: "r-2",
        method: "call",
        name: "mcp__files__read",
        arguments: { path: "a" },
      }),
    ).toEqual({ requestId: "r-2", method: "call", name: "mcp__files__read", arguments: { path: "a" } });

    // A call without a name is not a request this host can answer.
    expect(
      webuiMiniAppToolRequest({
        type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
        requestId: "r-3",
        method: "call",
      }),
    ).toBeUndefined();

    expect(
      webuiMiniAppToolRequest({
        type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
        requestId: "r-4",
        method: "delete",
      }),
    ).toBeUndefined();

    expect(webuiMiniAppToolRequest(null)).toBeUndefined();
  });

  it("does not carry an identity the page could have set", async () => {
    const call = vi.fn(async () => ({ tools: [] }));
    const request = webuiMiniAppToolRequest({
      type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
      requestId: "r-9",
      method: "list",
      pluginId: "another-app",
      sessionId: "another-session",
    });
    expect(request).toBeDefined();

    await webuiMiniAppToolAnswer({ request: request!, port: { miniAppToolCall: call }, pluginId: "pet" });

    expect(call).toHaveBeenCalledWith({ pluginId: "pet", method: "list" });
  });

  it("says the capability is absent instead of answering an empty list", async () => {
    const request = webuiMiniAppToolRequest({
      type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
      requestId: "r-10",
      method: "list",
    });

    await expect(
      webuiMiniAppToolAnswer({ request: request!, port: {}, pluginId: "pet" }),
    ).resolves.toEqual({ ok: false, code: "capability_unavailable" });
  });

  it("answers with the code the runtime refused with", async () => {
    const request = webuiMiniAppToolRequest({
      type: WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
      requestId: "r-11",
      method: "call",
      name: "mcp__files__read",
      arguments: {},
    });

    await expect(
      webuiMiniAppToolAnswer({
        request: request!,
        port: {
          miniAppToolCall: async () => {
            throw Object.assign(new Error("not permitted"), { code: "TOOL_NOT_PERMITTED" });
          },
        },
        pluginId: "pet",
      }),
    ).resolves.toEqual({ ok: false, code: "TOOL_NOT_PERMITTED" });
  });
});
