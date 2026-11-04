// The page-side watch: `window.mcode.miniapp.agent.observe(input, { onEvent })`.
//
// One seam, and it is the wire: what a page puts on it to start a watch, what it does with
// each event the host sends back, and how its promise settles. The rules are the ones a
// page's own code depends on:
//
//   * An event nobody is watching for is ignored — a page that cancelled gets nothing more.
//   * The promise settles exactly once, at the end message, with the runtime's code when
//     the watch could not open and with nothing when it ran its course.
//   * `cancel` settles the page's promise itself. The page asked to stop; waiting for the
//     host to confirm would leave the promise pending if the frame is going away.

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import { miniAppPageBridge } from "../../src/server/miniapp/bridge.js";
import {
  WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE,
  WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_END,
  WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_EVENT,
} from "../../src/shared/contracts/miniapp-agent.js";

interface AgentApi {
  observe(
    input: unknown,
    options: { onEvent: (event: unknown) => void },
  ): Promise<void>;
  cancel(requestId: string): void;
}

function page() {
  const posted: Array<Record<string, unknown>> = [];
  const listeners: Array<(event: unknown) => void> = [];
  const window = {
    mcode: {},
    parent: { postMessage: (data: Record<string, unknown>) => posted.push(data) },
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      if (name === "message") listeners.push(handler);
    },
  };
  // The page script reads these at load: it measures the page's own background
  // (`document.documentElement` / `document.body`) and watches for the host
  // painting over it (`MutationObserver`). A served document has all three; this
  // context is a bare vm, so the harness supplies them.
  const surface = {
    style: {
      getPropertyValue: () => "",
      getPropertyPriority: () => "",
      setProperty: () => undefined,
      removeProperty: () => undefined,
    },
    classList: { contains: () => false, toggle: () => undefined },
  };
  class MutationObserverStub {
    observe() {}
    disconnect() {}
  }
  const document = { documentElement: surface, body: surface };
  runInNewContext(miniAppPageBridge().script, { window, Map, Math, Date, Promise, Error, document, MutationObserver: MutationObserverStub, WeakMap });
  const agent = (window.mcode as { miniapp: { agent: AgentApi } }).miniapp.agent;

  const deliver = (data: Record<string, unknown>) => {
    for (const listener of listeners) listener({ source: window.parent, data });
  };

  return {
    agent,
    posted,
    event(requestId: string, event: unknown) {
      deliver({ type: WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_EVENT, requestId, event });
    },
    end(requestId: string, ok: boolean, code?: string) {
      deliver({
        type: WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_END,
        requestId,
        ok,
        ...(code === undefined ? {} : { code }),
      });
    },
  };
}

describe("a watch a page opens", () => {
  it("asks the host for every conversation, with an id it can cancel by", async () => {
    const harness = page();
    const pending = harness.agent.observe({ all: true }, { onEvent: () => undefined });

    const request = harness.posted.at(-1);
    expect(request?.type).toBe(WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE);
    expect(request?.all).toBe(true);
    expect(typeof request?.requestId).toBe("string");

    harness.end(request?.requestId as string, true);
    await expect(pending).resolves.toBeUndefined();
  });

  it("hands each settled turn to the page's handler", () => {
    const harness = page();
    const seen: unknown[] = [];
    void harness.agent.observe({ all: true }, { onEvent: (event) => seen.push(event) });

    const requestId = harness.posted.at(-1)?.requestId as string;
    harness.event(requestId, { type: "turn.finished", sessionId: "s1", outcome: "finished" });
    harness.event("not-a-watch", { type: "turn.finished", sessionId: "s2" });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ sessionId: "s1" });
  });

  it("rejects with the runtime's code when the watch could not open", async () => {
    const harness = page();
    const pending = harness.agent.observe({ sessionId: "s1" }, { onEvent: () => undefined });

    harness.end(harness.posted.at(-1)?.requestId as string, false, "not_permitted");

    await expect(pending).rejects.toThrow("not_permitted");
  });

  it("settles the page's own promise on cancel, then tells the host", async () => {
    const harness = page();
    const pending = harness.agent.observe({ all: true }, { onEvent: () => undefined });
    const requestId = harness.posted.at(-1)?.requestId as string;

    harness.agent.cancel(requestId);

    await expect(pending).resolves.toBeUndefined();
    expect(harness.posted.at(-1)).toMatchObject({
      type: WEBUI_MINIAPP_BRIDGE_AGENT_OBSERVE_END,
      requestId,
      cancel: true,
    });
  });

  it("refuses a watch with no handler or no target", async () => {
    const harness = page();

    await expect(
      harness.agent.observe({ all: true }, {} as never),
    ).rejects.toThrow("invalid_request");
    await expect(harness.agent.observe({}, { onEvent: () => undefined })).rejects.toThrow(
      "invalid_request",
    );
    expect(harness.posted).toHaveLength(0);
  });
});
