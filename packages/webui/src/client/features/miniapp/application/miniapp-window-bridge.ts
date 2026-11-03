// The page bridge's window channel, host side.
//
// The proxy injects the page half; this is the half that runs in the client and answers
// it. A page asks where its box is and moves it; the client answers with the box it
// actually has.
//
// The patch is applied by `applyMiniAppWindowPatch`, so this file adds only what the
// wire needs: which methods exist, what a malformed message means, and the fact that a
// state push answers a request *and* reaches the page's subscribers — the page's
// `onDidChangeState` is fed by the same message that resolves its `await`.
//
// `focus` carries no state change: focusing a document is what the host view does to
// the frame it already has, and the page asked for it from a click handler.

import {
  WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST,
  applyMiniAppWindowPatch,
  toMiniAppWindowState,
  type MiniAppWindowBox,
  type WebuiMiniAppWindowBounds,
  type WebuiMiniAppWindowPatch,
  type WebuiMiniAppWindowState,
} from "../../../../shared/contracts/miniapp-window.js";

export interface WebuiMiniAppWindowRequestMessage {
  readonly requestId: string;
  readonly method: "get" | "update" | "focus";
  readonly patch?: WebuiMiniAppWindowPatch;
}

/** Reads one window request out of a message's data, or nothing. */
export function webuiMiniAppWindowRequest(
  data: unknown,
): WebuiMiniAppWindowRequestMessage | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  if (record.type !== WEBUI_MINIAPP_BRIDGE_WINDOW_REQUEST) return undefined;

  const requestId = record.requestId;
  if (typeof requestId !== "string" || !requestId) return undefined;

  switch (record.method) {
    case "get":
    case "focus":
      return { requestId, method: record.method };
    case "update": {
      const patch = record.patch;
      // An array is an object to JavaScript and meaningless as a patch, so it is
      // refused here rather than applied as an object with numeric keys.
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return undefined;
      return { requestId, method: "update", patch: patch as WebuiMiniAppWindowPatch };
    }
    default:
      return undefined;
  }
}

export interface WebuiMiniAppWindowOutcome {
  readonly box: MiniAppWindowBox;
  readonly state: WebuiMiniAppWindowState;
  /** Fields the request named that this host could not honour. */
  readonly ignored: readonly string[];
}

/**
 * Applies one parsed request to the box the host is drawing.
 *
 * `get` and `focus` answer with the current state so the page can act on the answer
 * without a second round trip; only `update` can move the box.
 */
export function answerMiniAppWindowRequest(input: {
  readonly box: MiniAppWindowBox;
  readonly bounds: WebuiMiniAppWindowBounds;
  readonly message: WebuiMiniAppWindowRequestMessage;
}): WebuiMiniAppWindowOutcome {
  if (input.message.method !== "update") {
    return { box: input.box, state: toMiniAppWindowState(input.box), ignored: [] };
  }

  const applied = applyMiniAppWindowPatch(input.box, input.message.patch ?? {}, input.bounds);

  return {
    box: applied.state,
    state: toMiniAppWindowState(applied.state),
    ignored: applied.ignored,
  };
}
