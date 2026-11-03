// The window channel a page reaches: `window.mcode.miniapp.window.*`.
//
// One seam: what the page script puts on the wire. A page asks for its box with a
// method name and a patch, and gets back the state its own code reads
// (`{mode, window?: {x,y,width,height,clickThrough}}`). The script forwards the patch
// unexamined — clamping and refusal belong to the host, which is the only side that
// knows the host page's bounds — and it refuses a patch that is not an object, because a
// malformed request has no meaning worth sending.

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import { miniAppPageBridge } from "../../src/server/miniapp/bridge.js";
import {
  WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST,
  WEBUI_MINIAPP_BRIDGE_WINDOW_STATE,
} from "../../src/shared/contracts/miniapp-window.js";

interface PageApi {
  getState(): Promise<{ mode: string; window?: Record<string, number | boolean> }>;
  update(patch: unknown): Promise<{ mode: string }>;
  focus(): Promise<unknown>;
  onDidChangeState(listener: (state: unknown) => void): { dispose?(): void } | undefined;
}

function page() {
  const posted: Array<Record<string, unknown>> = [];
  // Every channel the script serves registers its own listener; keeping only the last
  // would disable the others.
  const listeners: Array<(event: unknown) => void> = [];
  const window = {
    mcode: {},
    parent: { postMessage: (data: Record<string, unknown>) => posted.push(data) },
    addEventListener: (name: string, handler: (event: unknown) => void) => {
      if (name === "message") listeners.push(handler);
    },
  };
  const surface = (backgroundColor: string) => {
    const declarations = new Map<string, { value: string; priority: string }>([
      ["background-color", { value: backgroundColor, priority: "" }],
    ]);
    return {
      style: {
        getPropertyValue: (name: string) => declarations.get(name)?.value ?? "",
        getPropertyPriority: (name: string) => declarations.get(name)?.priority ?? "",
        setProperty: (name: string, value: string, priority = "") => declarations.set(name, { value, priority }),
        removeProperty: (name: string) => declarations.delete(name),
      },
    };
  };
  const document = {
    documentElement: surface("rgb(1, 2, 3)"),
    body: surface("rgb(4, 5, 6)"),
  };
  class MutationObserverStub {
    observe() {}
    disconnect() {}
  }
  // The script's window channel times out an unanswered request, so the context it runs
  // in needs its own timers: collecting them is what lets a test answer "the host never
  // replied" without waiting.
  const timers: Array<() => void> = [];
  runInNewContext(miniAppPageBridge().script, {
    window,
    Map,
    Math,
    Date,
    Promise,
    Error,
    setTimeout: (handler: () => void) => {
      timers.push(handler);
      return timers.length;
    },
    clearTimeout: () => undefined,
    document,
    MutationObserver: MutationObserverStub,
    WeakMap,
  });

  const api = (window.mcode as { miniapp: { window: PageApi } }).miniapp.window;

  return {
    api,
    posted,
    document,
    fireTimers() {
      for (const timer of timers.splice(0)) timer();
    },
    /** Acts as the host view: answers the request the page is waiting on. */
    answer(state: unknown, requestId?: string) {
      for (const listener of listeners) {
        listener({
          source: window.parent,
          data: { type: WEBUI_MINIAPP_BRIDGE_WINDOW_STATE, requestId, state },
        });
      }
    },
    /** Acts as the host view: reports a change nobody asked for. */
    push(state: unknown) {
      for (const listener of listeners) {
        listener({
          source: window.parent,
          data: { type: WEBUI_MINIAPP_BRIDGE_WINDOW_STATE, state },
        });
      }
    },
    /** Acts as any other framed document: its state push must not reach the page. */
    pushFrom(source: unknown, state: unknown) {
      for (const listener of listeners) {
        listener({
          source,
          data: { type: WEBUI_MINIAPP_BRIDGE_WINDOW_STATE, state },
        });
      }
    },
  };
}

describe("the page-side window API", () => {
  it("asks for its state and resolves with the shape its own code reads", async () => {
    const harness = page();
    const pending = harness.api.getState();

    const request = harness.posted.at(-1);
    expect(request?.type).toBe(WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST);
    expect(request?.method).toBe("get");
    expect(typeof request?.requestId).toBe("string");

    harness.answer(
      { mode: "window", window: { x: 10, y: 20, width: 280, height: 340, clickThrough: false, transparent: false } },
      request?.requestId as string,
    );

    await expect(pending).resolves.toEqual({
      mode: "window",
      window: { x: 10, y: 20, width: 280, height: 340, clickThrough: false, transparent: false },
    });
  });

  it("sends a patch as given, because only the host knows what it can honour", async () => {
    const harness = page();
    const pending = harness.api.update({ mode: "window", width: 280, height: 340 });

    const request = harness.posted.at(-1);
    expect(request?.method).toBe("update");
    expect(request?.patch).toEqual({ mode: "window", width: 280, height: 340 });

    harness.answer({ mode: "window" }, request?.requestId as string);
    await expect(pending).resolves.toEqual({ mode: "window" });
  });

  it("refuses a patch that is not an object without putting it on the wire", async () => {
    const harness = page();

    await expect(harness.api.update("window")).rejects.toThrow("invalid_request");
    await expect(harness.api.update(null)).rejects.toThrow("invalid_request");
    expect(harness.posted).toHaveLength(0);
  });

  it("rejects instead of leaving the page waiting when the host never answers", async () => {
    const harness = page();
    const pending = harness.api.getState();
    const refused = expect(pending).rejects.toThrow("result_unknown");

    harness.fireTimers();
    await refused;
  });

  it("reports a change the host made to a subscribed page, and stops after dispose", () => {
    const harness = page();
    const seen: unknown[] = [];
    const subscription = harness.api.onDidChangeState((state) => seen.push(state));

    harness.push({ mode: "window", window: { x: 0, y: 0, width: 280, height: 340, clickThrough: false, transparent: false } });
    expect(seen).toHaveLength(1);

    subscription?.dispose?.();
    harness.push({ mode: "inline" });
    expect(seen).toHaveLength(1);
  });

  it("makes a requested floating page transparent and restores its own inline backgrounds", () => {
    const harness = page();
    const root = harness.document.documentElement.style;
    const body = harness.document.body.style;

    harness.push({ mode: "window", window: { transparent: true } });
    expect(root.getPropertyValue("background-color")).toBe("transparent");
    expect(root.getPropertyPriority("background-color")).toBe("important");
    expect(body.getPropertyValue("background-color")).toBe("transparent");

    harness.push({ mode: "window", window: { transparent: false } });
    expect(root.getPropertyValue("background-color")).toBe("rgb(1, 2, 3)");
    expect(body.getPropertyValue("background-color")).toBe("rgb(4, 5, 6)");
  });

  it("exposes focus, which the page calls from a click handler", async () => {
    const harness = page();
    const pending = harness.api.focus();

    const request = harness.posted.at(-1);
    expect(request?.method).toBe("focus");

    harness.answer({ mode: "window" }, request?.requestId as string);
    await pending;
  });
});

describe("a state push from a stranger", () => {
  it("is ignored when it does not come from the parent window", () => {
    const harness = page();
    const seen: unknown[] = [];
    harness.api.onDidChangeState((state) => seen.push(state));

    harness.pushFrom({ tag: "some-other-frame" }, { mode: "window" });
    expect(seen).toEqual([]);

    harness.push({ mode: "inline" });
    expect(seen).toEqual([{ mode: "inline" }]);
  });
});
