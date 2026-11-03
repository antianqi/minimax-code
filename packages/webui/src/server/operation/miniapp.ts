// The Mini App surface: the catalogue, the launch, the stop, and the standalone
// presentation lease.
//
// Five descriptors over one runtime capability. The first three are dedicated
// handlers rather than bindings (`handlers/miniapp.ts`), because two of them do
// more than forward one call: `openMiniApp` turns the runtime's launch
// coordinates into a loopback proxy and answers with that proxy's URL, and
// `stopMiniApp` closes the proxy it left behind. Keeping the catalogue beside
// them keeps the capability's declarations in one place — a host either has Mini
// Apps or it does not.
//
// `watchMiniAppPresentation` holds the standalone document's lease, and
// `watchMiniAppPresenter` carries agent-driven show/close requests to the client.
import type {
  WebuiMiniAppCatalogue,
  WebuiMiniAppPermissionList,
  WebuiMiniAppView,
} from "../../shared/contracts/miniapp.js";
import { isWebuiMiniAppOpenPath } from "../../shared/contracts/miniapp.js";
import {
  WEBUI_MINIAPP_TOOL_MAX_NAMES,
  type WebuiMiniAppToolApprovalAnswer,
  type WebuiMiniAppToolResult,
} from "../../shared/contracts/miniapp-tools.js";
import { WebuiErrorCode } from "../../shared/envelope.js";
import {
  CALL_MINI_APP_TOOL_OPERATION_NAME,
  REPLY_MINI_APP_TOOL_APPROVAL_OPERATION_NAME,
  WATCH_MINI_APP_TOOL_APPROVALS_OPERATION_NAME,
  LIST_MINI_APPS_OPERATION_NAME,
  LIST_MINI_APP_PERMISSIONS_OPERATION_NAME,
  OPEN_MINI_APP_OPERATION_NAME,
  SET_MINI_APP_PERMISSION_OPERATION_NAME,
  STOP_MINI_APP_OPERATION_NAME,
  WATCH_MINI_APP_PRESENTATION_OPERATION_NAME,
  WATCH_MINI_APP_PRESENTER_OPERATION_NAME,
} from "../../shared/operation-names.js";
import type {
  WebuiOperation,
  WebuiOperationValidation,
} from "./operation-contract.js";

/**
 * Longest plugin or session id a frame may carry.
 *
 * Not a runtime limit — the runtime's own catalogue decides what exists — but a
 * bound on what reaches the log, the error text and the plugin-id-keyed proxy map
 * this capability keeps. A frame naming a 4MB id is a frame that is not asking
 * about an installed Mini App.
 */
const MAX_ID_LENGTH = 200;

/** Longest permission id a frame may carry; the runtime's own ids are `domain:item`. */
const MAX_PERMISSION_LENGTH = 200;

/**
 * `listMiniApps` takes no body, and says so rather than accepting a record it
 * ignores: an operation that silently drops input invites a caller to believe the
 * input narrowed the catalogue.
 */
export const listMiniAppsOperation: WebuiOperation<undefined, WebuiMiniAppCatalogue> = {
  name: LIST_MINI_APPS_OPERATION_NAME,
  validate: (body) =>
    body === undefined
      ? { ok: true, body: undefined }
      : {
          ok: false,
          code: WebuiErrorCode.invalidBody,
          message: `${LIST_MINI_APPS_OPERATION_NAME} does not accept a body`,
        },
};

/**
 * The one field the two Mini App mutations carry.
 *
 * Trimmed and non-empty: the id reaches a derived proxy port and a runtime lookup,
 * and neither has anything to say about a blank one. `pluginId` is the runtime's
 * own key — the catalogue's rows and this request name the same value, so a client
 * never has to translate between an index and an identity.
 */
function validatePluginId(
  operation: string,
  body: unknown,
): WebuiOperationValidation<{ readonly pluginId: string }> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body must be an object`,
    };
  const pluginId = (body as Record<string, unknown>).pluginId;
  if (typeof pluginId !== "string" || !pluginId.trim())
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body requires a non-empty pluginId`,
    };
  if (pluginId.length > MAX_ID_LENGTH)
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} pluginId must be at most ${MAX_ID_LENGTH} characters`,
    };
  return { ok: true, body: { pluginId: pluginId.trim() } };
}

/**
 * Starts one Mini App. The response is the loopback URL the client frames, not the
 * Mini App's own origin: the origin, the surface path and the launch credential
 * are the proxy's business (`server/miniapp/proxy.ts`) and never travel further
 * than the server.
 */
export const openMiniAppOperation: WebuiOperation<
  { readonly pluginId: string; readonly path?: string },
  WebuiMiniAppView
> = {
  name: OPEN_MINI_APP_OPERATION_NAME,
  validate: (body) => validateOpenMiniApp(OPEN_MINI_APP_OPERATION_NAME, body),
};

/**
 * The two fields `openMiniApp` carries.
 *
 * `path` is the origin-relative page the Agent named, when it named one. It is
 * checked against the shipped runtime's surface rules here, so a path the runtime
 * would refuse is refused before a process is started for it.
 */
function validateOpenMiniApp(
  operation: string,
  body: unknown,
): WebuiOperationValidation<{ readonly pluginId: string; readonly path?: string }> {
  const pluginId = validatePluginId(operation, body);
  if (!pluginId.ok) return pluginId;
  const path = (body as Record<string, unknown>).path;
  if (path !== undefined && !isWebuiMiniAppOpenPath(path)) {
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} path must be an origin-relative path`,
    };
  }
  return {
    ok: true,
    body: {
      pluginId: pluginId.body.pluginId,
      ...(path !== undefined ? { path } : {}),
    },
  };
}

/**
 * Stops one Mini App. Answers `success` rather than the runtime's `void` so the
 * client has a body to read: an empty response and a dropped connection would
 * otherwise look the same.
 */
export const stopMiniAppOperation: WebuiOperation<
  { readonly pluginId: string },
  { readonly success: true }
> = {
  name: STOP_MINI_APP_OPERATION_NAME,
  validate: (body) => validatePluginId(STOP_MINI_APP_OPERATION_NAME, body),
};

/** One package's declared Mini App permissions with the stored switches. */
export const listMiniAppPermissionsOperation: WebuiOperation<
  { readonly pluginId: string },
  WebuiMiniAppPermissionList
> = {
  name: LIST_MINI_APP_PERMISSIONS_OPERATION_NAME,
  validate: (body) => validatePluginId(LIST_MINI_APP_PERMISSIONS_OPERATION_NAME, body),
};

/**
 * Stores one switch.
 *
 * `permission` is the `domain:item` id the list published, trimmed and bounded but
 * otherwise unread here: the runtime decides whether the package declares it, and a
 * second validator would be a second authority on what an id may look like.
 * `enabled` must be a boolean — `"false"` is not `false`.
 */
export const setMiniAppPermissionOperation: WebuiOperation<
  {
    readonly pluginId: string;
    readonly permission: string;
    readonly enabled: boolean;
  },
  WebuiMiniAppPermissionList
> = {
  name: SET_MINI_APP_PERMISSION_OPERATION_NAME,
  validate: (body) => {
    const plugin = validatePluginId(SET_MINI_APP_PERMISSION_OPERATION_NAME, body);
    if (!plugin.ok) return plugin;
    const permission = (body as Record<string, unknown>).permission;
    if (typeof permission !== "string" || !permission.trim())
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${SET_MINI_APP_PERMISSION_OPERATION_NAME} body requires a non-empty permission`,
      };
    if (permission.length > MAX_PERMISSION_LENGTH)
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${SET_MINI_APP_PERMISSION_OPERATION_NAME} permission must be at most ${MAX_PERMISSION_LENGTH} characters`,
      };
    const enabled = (body as Record<string, unknown>).enabled;
    if (typeof enabled !== "boolean")
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${SET_MINI_APP_PERMISSION_OPERATION_NAME} body requires a boolean enabled`,
      };
    return {
      ok: true,
      body: { pluginId: plugin.body.pluginId, permission: permission.trim(), enabled },
    };
  },
};

/**
 * One request from a framed page's tool channel.
 *
 * Three methods, one shape of answer. A `list` needs nothing but the package; a `request`
 * names the tools it asks about, bounded by the same limit the page script enforces; a
 * `call` names one tool and carries its arguments unread — the runtime decides what an
 * argument is, and a second validator here would be a second authority on the tool's own
 * schema.
 */
export const callMiniAppToolOperation: WebuiOperation<
  {
    readonly pluginId: string;
    readonly method: "list" | "request" | "call";
    readonly name?: string;
    readonly names?: readonly string[];
    readonly arguments?: unknown;
  },
  WebuiMiniAppToolResult
> = {
  name: CALL_MINI_APP_TOOL_OPERATION_NAME,
  validate: (body) => {
    const plugin = validatePluginId(CALL_MINI_APP_TOOL_OPERATION_NAME, body);
    if (!plugin.ok) return plugin;
    const pluginId = plugin.body.pluginId;
    const field = (body as Record<string, unknown>).method;
    const invalid = (message: string): WebuiOperationValidation<never> => ({
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${CALL_MINI_APP_TOOL_OPERATION_NAME} ${message}`,
    });

    if (field === undefined) return invalid("body requires a method");
    if (field !== "list" && field !== "request" && field !== "call")
      return invalid("method must be list, request or call");
    if (field === "list") return { ok: true, body: { pluginId, method: field } };
    if (field === "call") {
      const tool = (body as Record<string, unknown>).name;
      if (typeof tool !== "string" || !tool.trim()) return invalid("body requires a tool name");
      return {
        ok: true,
        body: {
          pluginId,
          method: field,
          name: tool.trim(),
          arguments: (body as Record<string, unknown>).arguments,
        },
      };
    }
    const names = (body as Record<string, unknown>).names;
    // The page script refuses these shapes before sending them; a request that arrives
    // anyway is answered the same way, so the two bounds cannot drift apart.
    if (
      !Array.isArray(names) ||
      names.length < 1 ||
      names.length > WEBUI_MINIAPP_TOOL_MAX_NAMES ||
      !names.every((entry) => typeof entry === "string" && entry.length > 0)
    )
      return invalid(`body requires between 1 and ${WEBUI_MINIAPP_TOOL_MAX_NAMES} tool names`);
    return { ok: true, body: { pluginId, method: field, names: names as readonly string[] } };
  },
};

/**
 * The prompts waiting for a person.
 *
 * No body: every client is shown the whole list and filters by `pluginId`, which is the
 * same set of Mini Apps it can already frame.
 */
export const watchMiniAppToolApprovalsOperation: WebuiOperation<undefined> = {
  name: WATCH_MINI_APP_TOOL_APPROVALS_OPERATION_NAME,
  validate: (body) =>
    body === undefined
      ? { ok: true, body: undefined }
      : {
          ok: false,
          code: WebuiErrorCode.invalidBody,
          message: `${WATCH_MINI_APP_TOOL_APPROVALS_OPERATION_NAME} does not accept a body`,
        },
};

/**
 * One answer to one prompt.
 *
 * `names` is only meaningful for a `request` prompt, and is bounded here rather than
 * left to the runtime: a client cannot ask about more tools than a page could.
 */
export const replyMiniAppToolApprovalOperation: WebuiOperation<WebuiMiniAppToolApprovalAnswer, {
  readonly success: true;
}> = {
  name: REPLY_MINI_APP_TOOL_APPROVAL_OPERATION_NAME,
  validate: (body) => {
    const plugin = validatePluginId(REPLY_MINI_APP_TOOL_APPROVAL_OPERATION_NAME, body);
    if (!plugin.ok) return plugin;
    const field = (body as Record<string, unknown>).requestId;
    if (typeof field !== "string" || !field.trim())
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${REPLY_MINI_APP_TOOL_APPROVAL_OPERATION_NAME} body requires a requestId`,
      };
    if (field.length > MAX_ID_LENGTH)
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${REPLY_MINI_APP_TOOL_APPROVAL_OPERATION_NAME} requestId must be at most ${MAX_ID_LENGTH} characters`,
      };
    const decision = (body as Record<string, unknown>).decision;
    if (decision !== "allow" && decision !== "deny" && decision !== "allowAlways")
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${REPLY_MINI_APP_TOOL_APPROVAL_OPERATION_NAME} decision must be allow, deny or allowAlways`,
      };
    const names = (body as Record<string, unknown>).names;
    if (
      names !== undefined &&
      (!Array.isArray(names) ||
        names.length > WEBUI_MINIAPP_TOOL_MAX_NAMES ||
        !names.every((entry) => typeof entry === "string" && entry.length > 0))
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${REPLY_MINI_APP_TOOL_APPROVAL_OPERATION_NAME} names must be at most ${WEBUI_MINIAPP_TOOL_MAX_NAMES} non-empty tool names`,
      };
    return {
      ok: true,
      body: {
        pluginId: plugin.body.pluginId,
        requestId: field.trim(),
        decision,
        ...(names !== undefined ? { names: names as readonly string[] } : {}),
      },
    };
  },
};

/**
 * Declares a standalone presentation, and holds it for the connection's life.
 *
 * Both ids are required: the lease names the plugin it presents and the session
 * its deep link carried, and the second is what lets the standalone view report an
 * ended session instead of silently rendering a page whose conversation is gone.
 */
export const watchMiniAppPresentationOperation: WebuiOperation<{
  readonly pluginId: string;
  readonly sessionId: string;
}> = {
  name: WATCH_MINI_APP_PRESENTATION_OPERATION_NAME,
  validate: (body) => {
    const plugin = validatePluginId(WATCH_MINI_APP_PRESENTATION_OPERATION_NAME, body);
    if (!plugin.ok) return plugin;
    const sessionId = (body as Record<string, unknown>).sessionId;
    if (typeof sessionId !== "string" || !sessionId.trim())
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${WATCH_MINI_APP_PRESENTATION_OPERATION_NAME} body requires a non-empty sessionId`,
      };
    if (sessionId.length > MAX_ID_LENGTH)
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${WATCH_MINI_APP_PRESENTATION_OPERATION_NAME} sessionId must be at most ${MAX_ID_LENGTH} characters`,
      };
    return { ok: true, body: { pluginId: plugin.body.pluginId, sessionId: sessionId.trim() } };
  },
};

/** Streams the runtime host's presentation state to the browser client. */
export const watchMiniAppPresenterOperation: WebuiOperation<undefined> = {
  name: WATCH_MINI_APP_PRESENTER_OPERATION_NAME,
  validate: (body) =>
    body === undefined
      ? { ok: true, body: undefined }
      : {
          ok: false,
          code: WebuiErrorCode.invalidBody,
          message: `${WATCH_MINI_APP_PRESENTER_OPERATION_NAME} does not accept a body`,
        },
};
