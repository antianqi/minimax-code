// The page bridge's tool channel, host side.
//
// The proxy injects the page half; this is the half that runs in the client and
// answers. It is deliberately smaller than the agent bridge: tools have no turns, no
// streaming and no cancel, so one request is one answer.
//
// Three rules:
//
//   * **The page names no identity.** `pluginId` is the host's, taken from the view the
//     frame belongs to. A page that sent one is ignored, not obeyed — the test pins
//     that a forged `pluginId` does not reach the runtime.
//   * **A shape the page should not be able to produce is refused here.** A call with no
//     name, a method this channel does not have, more names than the wire allows: all
//     `undefined`, and the caller answers `invalid_request` without dispatching.
//   * **A host without the capability says so.** `capability_unavailable` is not an
//     empty listing: a page that is told "no tools" when it is really "you may not ask"
//     would build the wrong UI.

import {
  WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST,
  WEBUI_MINIAPP_TOOL_MAX_NAMES,
  webuiMiniAppToolRefusalCode,
  type WebuiMiniAppToolRequest,
  type WebuiMiniAppToolResult,
} from "../../../../shared/contracts/miniapp-tools.js";

/**
 * The runtime call this channel forwards to.
 *
 * Its value is `unknown` on purpose: the client relays the runtime's answer and does
 * not interpret it. `pluginId` comes from the host, never from the message.
 */
export interface WebuiMiniAppToolCallPort {
  readonly miniAppToolCall?: (input: {
    readonly pluginId: string;
    readonly method: 'list' | 'request' | 'call';
    readonly name?: string;
    readonly names?: readonly string[];
    readonly arguments?: unknown;
  }) => Promise<unknown>;
}

/** Reads one tool request out of a message's data, or nothing. */
export function webuiMiniAppToolRequest(data: unknown): WebuiMiniAppToolRequest | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  if (record.type !== WEBUI_MINIAPP_BRIDGE_TOOL_REQUEST) return undefined;
  const requestId = record.requestId;
  if (typeof requestId !== "string" || !requestId) return undefined;

  switch (record.method) {
    case "list":
      return { requestId, method: "list" };
    case "request": {
      const names = record.names;
      if (!Array.isArray(names)) return undefined;
      if (names.length === 0 || names.length > WEBUI_MINIAPP_TOOL_MAX_NAMES) return undefined;
      if (!names.every((name) => typeof name === "string" && name.length > 0)) return undefined;
      return { requestId, method: "request", names: names as readonly string[] };
    }
    case "call": {
      const name = record.name;
      if (typeof name !== "string" || name.length === 0) return undefined;
      return { requestId, method: "call", name, arguments: record.arguments };
    }
    default:
      return undefined;
  }
}

/**
 * One request, answered.
 *
 * The runtime's refusals keep their codes: the page is told `TOOL_NOT_PERMITTED` rather
 * than a generic failure, because the page can act on the difference (list again, ask
 * for approval, stop trying).
 */
export async function webuiMiniAppToolAnswer(input: {
  readonly request: WebuiMiniAppToolRequest;
  readonly port: WebuiMiniAppToolCallPort;
  readonly pluginId: string;
}): Promise<WebuiMiniAppToolResult> {
  const call = input.port.miniAppToolCall;
  if (typeof call !== "function") return { ok: false, code: "capability_unavailable" };

  try {
    const value = await call.call(input.port, {
      pluginId: input.pluginId,
      method: input.request.method,
      ...(input.request.method === "request" ? { names: input.request.names } : {}),
      ...(input.request.method === "call"
        ? { name: input.request.name, arguments: input.request.arguments }
        : {}),
    });
    return { ok: true, value: value as never };
  } catch (error) {
    return { ok: false, code: webuiMiniAppToolRefusalCode(error) };
  }
}
