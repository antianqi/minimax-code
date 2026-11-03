// A page's request to change the box it is shown in, applied to a browser-tab box.
//
// One seam: `applyMiniAppWindowPatch(state, patch, bounds)`. What it proves: the two
// modes a browser can honour swap; a size or a position is clamped into the host page
// rather than trusted; a field this client cannot honour is named in `ignored` instead of
// silently dropped; and a mode the page may not choose is refused. What it does not
// cover: the frame that renders the box (the view's own tests) and the page bridge.

import { describe, expect, it } from "vitest";

import {
  MINIAPP_WINDOW_DEFAULT_SIZE,
  WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST,
  applyMiniAppWindowPatch,
  initialMiniAppWindowState,
  miniAppWindowFrameLayout,
  toMiniAppWindowState,
} from "../../src/shared/contracts/miniapp-window.js";
import { webuiMiniAppWindowRequest } from "../../src/client/features/miniapp/application/miniapp-window-bridge.js";

const BOUNDS = { width: 1200, height: 800 };

describe("a page's window request", () => {
  it("starts inline, at the shipped size", () => {
    const state = initialMiniAppWindowState(BOUNDS);

    expect(state.mode).toBe("inline");
    expect(state.width).toBe(MINIAPP_WINDOW_DEFAULT_SIZE.width);
    expect(state.height).toBe(MINIAPP_WINDOW_DEFAULT_SIZE.height);
  });

  it("switches to a floating box and back, with the size it was given", () => {
    const floated = applyMiniAppWindowPatch(initialMiniAppWindowState(BOUNDS), {
      mode: "window",
      width: 320,
      height: 420,
    }, BOUNDS);

    expect(floated.state.mode).toBe("window");
    expect(floated.state.width).toBe(320);
    expect(floated.state.height).toBe(420);

    const inlined = applyMiniAppWindowPatch(floated.state, { mode: "inline" }, BOUNDS);
    expect(inlined.state.mode).toBe("inline");
    // The size the page asked for is kept: switching layout must not reset it.
    expect(inlined.state.width).toBe(320);
  });

  it("clamps a size into what the host page can show", () => {
    const tiny = applyMiniAppWindowPatch(initialMiniAppWindowState(BOUNDS), {
      width: 10,
      height: 10,
    }, BOUNDS);
    expect(tiny.state.width).toBeGreaterThanOrEqual(160);
    expect(tiny.state.height).toBeGreaterThanOrEqual(160);

    const huge = applyMiniAppWindowPatch(initialMiniAppWindowState(BOUNDS), {
      width: 5000,
      height: 5000,
    }, BOUNDS);
    expect(huge.state.width).toBeLessThanOrEqual(BOUNDS.width);
    expect(huge.state.height).toBeLessThanOrEqual(BOUNDS.height);
  });

  it("keeps the box inside the host page when the page moves it", () => {
    const state = initialMiniAppWindowState(BOUNDS);

    const negative = applyMiniAppWindowPatch(state, { x: -400, y: -400 }, BOUNDS);
    expect(negative.state.x).toBeGreaterThanOrEqual(0);
    expect(negative.state.y).toBeGreaterThanOrEqual(0);

    const past = applyMiniAppWindowPatch(state, { x: 10_000, y: 10_000 }, BOUNDS);
    expect(past.state.x).toBeLessThanOrEqual(BOUNDS.width - past.state.width);
    expect(past.state.y).toBeLessThanOrEqual(BOUNDS.height - past.state.height);
  });

  it("names a field it cannot honour instead of pretending it worked", () => {
    const result = applyMiniAppWindowPatch(initialMiniAppWindowState(BOUNDS), {
      mode: "window",
      alwaysOnTop: true,
      skipTaskbar: true,
    } as never, BOUNDS);

    expect(result.ignored.sort()).toEqual(["alwaysOnTop", "skipTaskbar"]);
    // The mode it could honour still landed.
    expect(result.state.mode).toBe("window");
  });

  it("refuses a mode the page may not choose", () => {
    const result = applyMiniAppWindowPatch(initialMiniAppWindowState(BOUNDS), {
      mode: "standalone",
    } as never, BOUNDS);

    expect(result.state.mode).toBe("inline");
    expect(result.ignored).toContain("mode");
  });

  it("hands the page the shape its own code reads", () => {
    expect(toMiniAppWindowState(initialMiniAppWindowState(BOUNDS))).toEqual({ mode: "inline" });

    const floated = applyMiniAppWindowPatch(initialMiniAppWindowState(BOUNDS), {
      mode: "window",
      x: 40,
      y: 60,
    }, BOUNDS).state;

    expect(toMiniAppWindowState(floated)).toEqual({
      mode: "window",
      window: { x: 40, y: 60, width: floated.width, height: floated.height, clickThrough: false },
    });
  });

  it("records click-through as a host-page-only behaviour", () => {
    const result = applyMiniAppWindowPatch(initialMiniAppWindowState(BOUNDS), {
      clickThrough: true,
    }, BOUNDS);

    expect(result.state.clickThrough).toBe(true);
    expect(result.ignored).not.toContain("clickThrough");
  });
});

describe("the layout the frame is drawn with", () => {
  it("keeps an inline page in the panel", () => {
    const layout = miniAppWindowFrameLayout(initialMiniAppWindowState(BOUNDS));

    expect(layout.floating).toBe(false);
    expect(layout.className).toBe("webui-miniapp-view-frame");
    expect(layout.style).toBeUndefined();
  });

  it("places a floating page at the box it asked for", () => {
    const box = applyMiniAppWindowPatch(
      initialMiniAppWindowState(BOUNDS),
      { mode: "window", x: 30, y: 40, width: 300, height: 400 },
      BOUNDS,
    ).state;

    const layout = miniAppWindowFrameLayout(box);

    expect(layout.floating).toBe(true);
    expect(layout.className).toBe("webui-miniapp-view-frame webui-miniapp-window-frame");
    expect(layout.style).toEqual({
      position: "fixed",
      left: 30,
      top: 40,
      width: 300,
      height: 400,
      pointerEvents: "auto",
    });
  });

  it("lets clicks fall through when the page asked for it", () => {
    const box = applyMiniAppWindowPatch(
      initialMiniAppWindowState(BOUNDS),
      { mode: "window", clickThrough: true },
      BOUNDS,
    ).state;

    expect(miniAppWindowFrameLayout(box).style?.pointerEvents).toBe("none");
  });
});

describe("reading a window request", () => {
  const request = (data: unknown) => webuiMiniAppWindowRequest(data);

  it("accepts the three methods a page can ask for", () => {
    expect(request({ type: WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST, requestId: "w1", method: "get" }))
      .toEqual({ requestId: "w1", method: "get" });
    expect(request({ type: WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST, requestId: "w2", method: "focus" }))
      .toEqual({ requestId: "w2", method: "focus" });
    expect(
      request({
        type: WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST,
        requestId: "w3",
        method: "update",
        patch: { mode: "window", width: 280, height: 340 },
      }),
    ).toEqual({
      requestId: "w3",
      method: "update",
      patch: { mode: "window", width: 280, height: 340 },
    });
  });

  it("refuses an update with no patch to apply", () => {
    expect(request({ type: WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST, requestId: "w4", method: "update" }))
      .toBeUndefined();
    expect(
      request({
        type: WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST,
        requestId: "w5",
        method: "update",
        patch: [],
      }),
    ).toBeUndefined();
  });

  it("refuses a message that is not this channel's", () => {
    expect(request({ type: "something.else", requestId: "w6", method: "get" })).toBeUndefined();
    expect(request({ type: WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST, method: "get" })).toBeUndefined();
    expect(request({ type: WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST, requestId: "w7", method: "resize" }))
      .toBeUndefined();
    expect(request(null)).toBeUndefined();
  });
});
