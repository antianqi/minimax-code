// The 接入 IM wire operations.
//
// The bot list, the create and bind of one bot, the two mutations the card performs on it
// (解除连接 / 删除Bot), the per-agent configuration check, and the read and write of one agent's
// message filter.
//
// They live in one file because they are one domain and one client business.
//
// Each validator checks the shape a browser may send — the platform a create flow adds, the
// credentials a bind carries, the connection a mutation acts on — and never learns the runtime's
// model: the runtime's channel-bridge routes answer behind the harness adapter, and the wire
// contract (`shared/contracts/channel.ts`) is what the browser is given.
//
// The app secret travels once, in the request, and is never echoed back: it is read here for its
// shape and handed to the service that binds the client, and no validator ever puts its value in
// a message.
import { WebuiErrorCode } from "../../shared/envelope.js";
import {
  CHECK_CHANNEL_CONFIG_OPERATION_NAME,
  CONNECT_CHANNEL_OPERATION_NAME,
  DELETE_CHANNEL_CONNECTION_OPERATION_NAME,
  DISCONNECT_CHANNEL_CONNECTION_OPERATION_NAME,
  GET_CHANNEL_MESSAGE_FILTER_OPERATION_NAME,
  GET_CHANNEL_WECHAT_BIND_STATUS_OPERATION_NAME,
  LIST_CHANNEL_CONNECTIONS_OPERATION_NAME,
  PREPARE_CHANNEL_CONNECTION_OPERATION_NAME,
  START_CHANNEL_WECHAT_BIND_OPERATION_NAME,
  UPDATE_CHANNEL_MESSAGE_FILTER_OPERATION_NAME,
} from "../../shared/operation-names.js";
import type {
  WebuiChannelConfigCheckRequest,
  WebuiChannelConfigCheckResult,
  WebuiChannelConnectRequest,
  WebuiChannelConnectionList,
  WebuiChannelConnectionRequest,
  WebuiChannelMessageFilter,
  WebuiChannelMessageFilterMode,
  WebuiChannelMessageFilterRequest,
  WebuiChannelOperationResult,
  WebuiChannelPrepareRequest,
  WebuiChannelWechatBindStartRequest,
  WebuiChannelWechatBindStartResult,
  WebuiChannelWechatBindStatusRequest,
  WebuiChannelWechatBindStatusResult,
} from "../../shared/contracts/channel.js";
import type { WebuiOperation, WebuiOperationValidation } from "./operation-contract.js";

/** The one refusal shape the six validators share. */
function invalid(message: string): {
  readonly ok: false;
  readonly code: typeof WebuiErrorCode.invalidBody;
  readonly message: string;
} {
  return { ok: false, code: WebuiErrorCode.invalidBody, message };
}

/** A body the browser may omit entirely. */
function validateNoBody(operation: string, body: unknown): WebuiOperationValidation<undefined> {
  if (body === undefined || body === null) return { ok: true, body: undefined };
  if (typeof body === "object" && !Array.isArray(body)) {
    const keys = Object.keys(body as Record<string, unknown>);
    if (keys.length === 0) return { ok: true, body: undefined };
  }
  return invalid(`${operation} does not take a body`);
}

/** The name a client is keyed by. It is the identity the runtime stores the binding under. */
function readName(value: unknown): string | { readonly error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { error: "name must be a non-empty string" };
  }
  return value;
}

/** The agent a per-agent read or write names. */
function readAgent(value: unknown): string | { readonly error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { error: "agent must be a non-empty string" };
  }
  return value;
}

/** An optional string a browser may omit; a present one still has to be a string. */
function readOptionalText(
  value: unknown,
  field: string,
): string | undefined | { readonly error: string } {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return { error: `${field} must be a string` };
  return value;
}

const MESSAGE_FILTER_MODES: readonly WebuiChannelMessageFilterMode[] = ["result", "full"];

export const listChannelConnectionsOperation: WebuiOperation<
  undefined,
  WebuiChannelConnectionList
> = {
  name: LIST_CHANNEL_CONNECTIONS_OPERATION_NAME,
  validate: (body) => validateNoBody(LIST_CHANNEL_CONNECTIONS_OPERATION_NAME, body),
};

/** The platform a create flow adds a bot for. */
export const prepareChannelConnectionOperation: WebuiOperation<
  WebuiChannelPrepareRequest,
  WebuiChannelOperationResult
> = {
  name: PREPARE_CHANNEL_CONNECTION_OPERATION_NAME,
  validate: (body) => {
    if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
      return invalid(`${PREPARE_CHANNEL_CONNECTION_OPERATION_NAME} body must be an object`);
    }
    const value = body as Record<string, unknown>;
    const platform = readName(value.platform);
    if (typeof platform !== "string") return invalid("platform must be a non-empty string");
    const agent = readOptionalText(value.agent, "agent");
    if (agent !== undefined && typeof agent !== "string") return invalid(agent.error);
    return {
      ok: true,
      body: {
        platform,
        ...(agent === undefined ? {} : { agent }),
      },
    };
  },
};

/** Which bot a Connection mutation acts on. */
function readConnectionRequest(
  operation: string,
  body: unknown,
): WebuiOperationValidation<WebuiChannelConnectionRequest> {
  if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
    return invalid(`${operation} body must be an object`);
  }
  const connectionId = readName((body as Record<string, unknown>).connectionId);
  if (typeof connectionId !== "string") {
    return invalid("connectionId must be a non-empty string");
  }
  return { ok: true, body: { connectionId } };
}

/** 解除连接: unbinds one bot's platform binding. */
export const disconnectChannelConnectionOperation: WebuiOperation<
  WebuiChannelConnectionRequest,
  WebuiChannelOperationResult
> = {
  name: DISCONNECT_CHANNEL_CONNECTION_OPERATION_NAME,
  validate: (body) => readConnectionRequest(DISCONNECT_CHANNEL_CONNECTION_OPERATION_NAME, body),
};

/** 删除Bot: removes one bot. */
export const deleteChannelConnectionOperation: WebuiOperation<
  WebuiChannelConnectionRequest,
  WebuiChannelOperationResult
> = {
  name: DELETE_CHANNEL_CONNECTION_OPERATION_NAME,
  validate: (body) => readConnectionRequest(DELETE_CHANNEL_CONNECTION_OPERATION_NAME, body),
};

export const connectChannelOperation: WebuiOperation<
  WebuiChannelConnectRequest,
  WebuiChannelOperationResult
> = {
  name: CONNECT_CHANNEL_OPERATION_NAME,
  validate: (body) => {
    if (body === undefined || body === null) {
      return invalid(`${CONNECT_CHANNEL_OPERATION_NAME} body must be an object`);
    }
    if (typeof body !== "object" || Array.isArray(body)) {
      return invalid(`${CONNECT_CHANNEL_OPERATION_NAME} body must be an object`);
    }
    const value = body as Record<string, unknown>;
    const name = readName(value.name);
    if (typeof name !== "string") return invalid(name.error);
    const appId = readOptionalText(value.appId, "appId");
    if (appId !== undefined && typeof appId !== "string") return invalid(appId.error);
    const appSecret = readOptionalText(value.appSecret, "appSecret");
    if (appSecret !== undefined && typeof appSecret !== "string") return invalid(appSecret.error);
    const connectionId = readOptionalText(value.connectionId, "connectionId");
    if (connectionId !== undefined && typeof connectionId !== "string") {
      return invalid(connectionId.error);
    }
    return {
      ok: true,
      body: {
        name,
        ...(appId === undefined ? {} : { appId }),
        ...(appSecret === undefined ? {} : { appSecret }),
        ...(connectionId === undefined ? {} : { connectionId }),
      },
    };
  },
};

export const checkChannelConfigOperation: WebuiOperation<
  WebuiChannelConfigCheckRequest,
  WebuiChannelConfigCheckResult
> = {
  name: CHECK_CHANNEL_CONFIG_OPERATION_NAME,
  validate: (body) => {
    if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
      return invalid(`${CHECK_CHANNEL_CONFIG_OPERATION_NAME} body must be an object`);
    }
    const agent = readAgent((body as Record<string, unknown>).agent);
    if (typeof agent !== "string") return invalid(agent.error);
    return { ok: true, body: { agent } };
  },
};

export const getChannelMessageFilterOperation: WebuiOperation<
  { readonly agent: string },
  WebuiChannelMessageFilter
> = {
  name: GET_CHANNEL_MESSAGE_FILTER_OPERATION_NAME,
  validate: (body) => {
    if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
      return invalid(`${GET_CHANNEL_MESSAGE_FILTER_OPERATION_NAME} body must be an object`);
    }
    const agent = readAgent((body as Record<string, unknown>).agent);
    if (typeof agent !== "string") return invalid(agent.error);
    return { ok: true, body: { agent } };
  },
};

/**
 * Starting the WeChat authorization the 接入 IM create flow shows a QR for.
 *
 * The runtime owns the route; this validator only checks the shape a browser may send — the bot's
 * name and, optionally, the agent it is bound to.
 */
export const startChannelWechatBindOperation: WebuiOperation<
  WebuiChannelWechatBindStartRequest,
  WebuiChannelWechatBindStartResult
> = {
  name: START_CHANNEL_WECHAT_BIND_OPERATION_NAME,
  validate: (body) => {
    if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
      return invalid(`${START_CHANNEL_WECHAT_BIND_OPERATION_NAME} body must be an object`);
    }
    const value = body as Record<string, unknown>;
    const name = readName(value.name);
    if (typeof name !== "string") return invalid(name.error);
    const agent = readOptionalText(value.agent, "agent");
    if (agent !== undefined && typeof agent !== "string") return invalid(agent.error);
    const connectionId = readOptionalText(value.connectionId, "connectionId");
    if (connectionId !== undefined && typeof connectionId !== "string") {
      return invalid(connectionId.error);
    }
    return {
      ok: true,
      body: {
        name,
        ...(agent === undefined ? {} : { agent }),
        ...(connectionId === undefined ? {} : { connectionId }),
      },
    };
  },
};

/**
 * Reading one WeChat authorization's state.
 *
 * The runtime files the authorization under a session, and under a connection once the scan has
 * confirmed it, so either names it.
 */
export const getChannelWechatBindStatusOperation: WebuiOperation<
  WebuiChannelWechatBindStatusRequest,
  WebuiChannelWechatBindStatusResult
> = {
  name: GET_CHANNEL_WECHAT_BIND_STATUS_OPERATION_NAME,
  validate: (body) => {
    if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
      return invalid(`${GET_CHANNEL_WECHAT_BIND_STATUS_OPERATION_NAME} body must be an object`);
    }
    const value = body as Record<string, unknown>;
    const sessionId = readOptionalText(value.sessionId, "sessionId");
    if (sessionId !== undefined && typeof sessionId !== "string") return invalid(sessionId.error);
    const connectionId = readOptionalText(value.connectionId, "connectionId");
    if (connectionId !== undefined && typeof connectionId !== "string") return invalid(connectionId.error);
    if (sessionId === undefined && connectionId === undefined) {
      return invalid(`${GET_CHANNEL_WECHAT_BIND_STATUS_OPERATION_NAME} body must name an authorization`);
    }
    return {
      ok: true,
      body: {
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(connectionId === undefined ? {} : { connectionId }),
      },
    };
  },
};

export const updateChannelMessageFilterOperation: WebuiOperation<
  WebuiChannelMessageFilterRequest,
  WebuiChannelMessageFilter
> = {
  name: UPDATE_CHANNEL_MESSAGE_FILTER_OPERATION_NAME,
  validate: (body) => {
    if (body === undefined || body === null || typeof body !== "object" || Array.isArray(body)) {
      return invalid(`${UPDATE_CHANNEL_MESSAGE_FILTER_OPERATION_NAME} body must be an object`);
    }
    const value = body as Record<string, unknown>;
    const agent = readAgent(value.agent);
    if (typeof agent !== "string") return invalid(agent.error);
    const filter = value.filter;
    if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
      return invalid("filter must be an object");
    }
    const record = filter as Record<string, unknown>;
    const mode = record.mode;
    if (typeof mode !== "string" || !MESSAGE_FILTER_MODES.includes(mode as WebuiChannelMessageFilterMode)) {
      return invalid("filter.mode must be 'result' or 'full'");
    }
    if (typeof record.includeToolSummary !== "boolean") {
      return invalid("filter.includeToolSummary must be a boolean");
    }
    return {
      ok: true,
      body: {
        agent,
        filter: {
          mode: mode as WebuiChannelMessageFilterMode,
          includeToolSummary: record.includeToolSummary,
        },
      },
    };
  },
};
