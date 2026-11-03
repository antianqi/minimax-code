/**
 * The box a Mini App page is shown in, and the page's request to change it.
 *
 * A page asks its host for a window because it wants to be more than a panel: it moves
 * itself, resizes itself, and follows those changes. A browser tab has no such window,
 * so this client honours the request with a floating box inside the page the user is
 * already looking at. That is a layout of the inline presentation, not a second
 * presentation: the same view keeps the same lease and the same iframe, so a page that
 * switches layout does not reload and does not lose what it was doing.
 *
 * The request is applied, not obeyed. Three fields cannot be honoured in a tab
 * (`alwaysOnTop` is a stacking hint that stops applying once the tab is in the
 * background, `skipTaskbar` has no meaning, and a page may not choose `standalone`
 * because that presentation is the user's choice), and every one of them is reported
 * back in `ignored` rather than silently dropped.
 */

export const WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST = "webui.miniapp.window.request";
export const WEBUI_MINIAPP_BRIDGE_WINDOW_STATE = "webui.miniapp.window.state";

/** No useful page fits in less, and the host page must still be visible behind it. */
export const MINIAPP_WINDOW_MIN_SIZE = 160;

/** Matches the shipped package's `surface.window` default closely enough to need no jump. */
export const MINIAPP_WINDOW_DEFAULT_SIZE = { width: 320, height: 420 } as const;

export type WebuiMiniAppWindowMode = "inline" | "window";

export interface WebuiMiniAppWindowBounds {
  readonly width: number;
  readonly height: number;
}

export interface MiniAppWindowBox {
  readonly mode: WebuiMiniAppWindowMode;
  readonly width: number;
  readonly height: number;
  readonly transparent: boolean;
  /** Distance from the host page's left edge. There is no screen coordinate here. */
  readonly x: number;
  readonly y: number;
}

export interface WebuiMiniAppWindowPatch {
  readonly mode?: string;
  readonly width?: number;
  readonly height?: number;
  readonly x?: number;
  readonly y?: number;
  readonly clickThrough?: boolean;
  readonly transparent?: boolean;
}

export interface WebuiMiniAppWindowResult {
  readonly state: MiniAppWindowBox;
  /** Fields the request named that this client did not apply, in request order. */
  readonly ignored: readonly string[];
}

/**
 * The state a page reads: the shape its `getState` / `update` / `onDidChangeState` talk
 * in. `window` is absent while the page is shown inline — the page checks the mode
 * first, so an inline page is never handed a box it cannot be in.
 */
export interface WebuiMiniAppWindowState {
  readonly mode: WebuiMiniAppWindowMode;
  readonly window?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly clickThrough: boolean;
    readonly transparent: boolean;
  };
}

export function toMiniAppWindowState(box: MiniAppWindowBox): WebuiMiniAppWindowState {
  if (box.mode !== "window") return { mode: "inline" };

  return {
    mode: "window",
    window: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      // Read by the page's own code; a tab never falls through, so it is always false.
      clickThrough: false,
      transparent: box.transparent,
    },
  };
}

/**
 * What a tab can honour. Click-through is absent on purpose: it is refused, so a page that
 * asks for it is told rather than handed a frame that ignores its pointer.
 */
const HONOURED = new Set(["mode", "width", "height", "x", "y", "transparent"]);
const MODES = new Set<WebuiMiniAppWindowMode>(["inline", "window"]);

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function initialMiniAppWindowState(bounds: WebuiMiniAppWindowBounds): MiniAppWindowBox {
  const width = clamp(MINIAPP_WINDOW_DEFAULT_SIZE.width, MINIAPP_WINDOW_MIN_SIZE, bounds.width);
  const height = clamp(MINIAPP_WINDOW_DEFAULT_SIZE.height, MINIAPP_WINDOW_MIN_SIZE, bounds.height);

  return {
    mode: "inline",
    width,
    height,
    transparent: false,
    x: clamp(Math.round((bounds.width - width) / 2), 0, bounds.width - width),
    y: clamp(Math.round((bounds.height - height) / 2), 0, bounds.height - height),
  };
}

export function applyMiniAppWindowPatch(
  state: MiniAppWindowBox,
  patch: WebuiMiniAppWindowPatch,
  bounds: WebuiMiniAppWindowBounds,
): WebuiMiniAppWindowResult {
  const ignored: string[] = [];

  for (const key of Object.keys(patch)) {
    if (!HONOURED.has(key)) ignored.push(key);
  }

  let mode = state.mode;

  if (patch.mode !== undefined) {
    if (MODES.has(patch.mode as WebuiMiniAppWindowMode)) {
      mode = patch.mode as WebuiMiniAppWindowMode;
    } else {
      // Present in the request and deliberately refused, so it belongs in `ignored`
      // even though the field itself is one this client can handle.
      ignored.push("mode");
    }
  }

  const width = clamp(
    finite(patch.width, state.width),
    MINIAPP_WINDOW_MIN_SIZE,
    bounds.width,
  );
  const height = clamp(
    finite(patch.height, state.height),
    MINIAPP_WINDOW_MIN_SIZE,
    bounds.height,
  );

  // A page that moves itself past an edge is pulled back with the box fully visible:
  // half a floating box hanging off the viewport has no way back.
  const x = clamp(finite(patch.x, state.x), 0, bounds.width - width);
  const y = clamp(finite(patch.y, state.y), 0, bounds.height - height);
  // A browser-tab window is layered over the host document. Make it transparent when
  // first detached so its viewport does not cover the page with an accidental white
  // rectangle; apps that need a solid surface can explicitly request transparent:false.
  const enteringWindow = patch.mode === "window" && state.mode !== "window";

  return {
    state: {
      mode,
      width,
      height,
      transparent: typeof patch.transparent === "boolean"
        ? patch.transparent
        : enteringWindow || state.transparent,
      x,
      y,
    },
    ignored,
  };
}

/**
 * How the frame that holds the page is drawn.
 *
 * The view applies this rather than rebuilding its own geometry rule, so the one place
 * that decides where a floating page sits is also the place a test can pin.
 */
export interface MiniAppWindowFrameLayout {
  readonly floating: boolean;
  readonly className: string;
  readonly style?: {
    readonly position: "fixed";
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly pointerEvents: "auto" | "none";
  };
}

export function miniAppWindowFrameLayout(box: MiniAppWindowBox): MiniAppWindowFrameLayout {
  if (box.mode !== "window") {
    return { floating: false, className: "webui-miniapp-view-frame" };
  }

  return {
    floating: true,
    className: "webui-miniapp-view-frame webui-miniapp-window-frame",
    style: {
      position: "fixed",
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
      pointerEvents: "auto",
    },
  };
}
