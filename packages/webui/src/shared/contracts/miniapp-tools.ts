// The tool channel between a Mini App page and the client that framed it.
//
// Three methods, and no identity in any of them: a page asks for the tools it may use,
// asks for approval of the ones it may not use yet, and calls one. Which plugin, which
// session and which switch are the host's to know — the page sends a method name and,
// where the method needs one, a tool name.
//
// The answer is one shape for all three: `ok` with a value, or `ok: false` with the
// code the runtime refused with. A page that has to distinguish "no tools" from "you
// may not use tools" needs that code, and an empty list would erase the difference.

/** The page's request. `type` is what a client matches before reading anything else. */
export const WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST = 'webui.miniapp.tool.request';

/** The host's answer to one request. */
export const WEBUI_MINIAPP_BRIDGE_TOOL_RESULT = 'webui.miniapp.tool.result';

/** One `request()` may name at most this many tools, as the runtime's own bound. */
export const WEBUI_MINIAPP_TOOL_MAX_NAMES = 10;

export type WebuiMiniAppToolMethod = 'list' | 'request' | 'call';

/** What the rules say about one tool, as a page is allowed to know it. */
export type WebuiMiniAppToolDecision = 'allow' | 'ask' | 'deny';

export interface WebuiMiniAppToolListingEntry {
  readonly name: string;
  readonly description?: string;
  readonly decision: WebuiMiniAppToolDecision;
}

export interface WebuiMiniAppToolListing {
  readonly tools: readonly WebuiMiniAppToolListingEntry[];
}

/** The state of every tool `request()` was asked about, and whether a person was reachable. */
export interface WebuiMiniAppToolPermissions {
  readonly permissions: Readonly<Record<string, WebuiMiniAppToolDecision>>;
  readonly approvalRequired: boolean;
}

/** A tool call's result, opaque to the host: the tool's own answer travels through. */
export interface WebuiMiniAppToolCallResult {
  readonly value: unknown;
}

export type WebuiMiniAppToolValue =
  | WebuiMiniAppToolListing
  | WebuiMiniAppToolPermissions
  | WebuiMiniAppToolCallResult;

export type WebuiMiniAppToolResult =
  | { readonly ok: true; readonly value: WebuiMiniAppToolValue }
  | { readonly ok: false; readonly code: string };

/**
 * The code a refusal carries, or the generic one when it carries none.
 *
 * Both halves read a refusal the same way: the server turns it into the page's answer,
 * and the client answers `tool_error` when the transport itself failed. One function so
 * the two cannot disagree about which code a page sees.
 */
export function webuiMiniAppToolRefusalCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return "tool_error";
}

/** A request as the host reads it, with the page's envelope dropped. */
export type WebuiMiniAppToolRequest =
  | { readonly requestId: string; readonly method: 'list' }
  | {
      readonly requestId: string;
      readonly method: 'request';
      readonly names: readonly string[];
    }
  | {
      readonly requestId: string;
      readonly method: 'call';
      readonly name: string;
      readonly arguments: unknown;
    };

/**
 * One prompt waiting for a person, as the panel renders it.
 *
 * `tools` is what is asking — a tool name, and the arguments preview the runtime
 * already bounded — so the panel never has to fetch a second thing to draw it.
 */
export interface WebuiMiniAppToolApprovalPrompt {
  readonly requestId: string;
  /** `call` asks about one dispatching call; `request` asks which tools to allow. */
  readonly mode: 'call' | 'request';
  readonly pluginId: string;
  readonly tools: readonly {
    readonly name: string;
    readonly kind?: string;
    readonly owner?: string;
    readonly tool?: string;
    readonly argumentsPreview?: string;
  }[];
}

/** The prompts waiting now, oldest first. The stream's only frame shape. */
export interface WebuiMiniAppToolApprovalFrame {
  readonly pending: readonly WebuiMiniAppToolApprovalPrompt[];
}

/**
 * One person's answer to one prompt.
 *
 * `names` is what a `request` prompt ticked; a `call` prompt has nothing to tick, so it
 * omits them. `allowAlways` is the only answer that outlives the call — it writes the
 * same global allow rule an Agent turn reads.
 */
export interface WebuiMiniAppToolApprovalAnswer {
  readonly pluginId: string;
  readonly requestId: string;
  readonly decision: 'allow' | 'deny' | 'allowAlways';
  readonly names?: readonly string[];
}
