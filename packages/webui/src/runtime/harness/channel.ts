// The 接入 IM cell of the harness port.
//
// The runtime owns the IM channel bridge: `routeLocalChannelBridgeInfraApi` serves its
// routes, and the runtime host exposes them through one
// narrow surface (`LocalRuntimeApiHost.channelBridge`). This adapter forwards and converts, and
// it decides nothing — not which clients are bound, not whether a bind worked.
//
// Two things happen here:
//
//   * the runtime's channel types stop at this file. `shared/contracts/channel.ts` is what the
//     browser may name, and `src/shared` may not import the runtime's channel types, so every
//     field is read and re-emitted. A field the wire declares as required is either read or
//     failed on (`WebuiResultShapeError`), because a client rendered with a guessed name is worse
//     than one that reports it could not be read.
//   * a host that carries no channel bridge answers with one refusal. The six members are
//     required on the port and optional on the host, so the absence is resolved once, here,
//     instead of at six call sites.
import type { WebuiHarnessPort } from "../port.js";
import type { WebuiRuntimeHostHandle } from "./host-contract.js";
import { requireHostSlot } from "./requirements.js";
import { WebuiResultShapeError } from "./result-conversion.js";
import type {
  WebuiChannelConfigCheckRequest,
  WebuiChannelConfigCheckResult,
  WebuiChannelConnectRequest,
  WebuiChannelConnection,
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

/** One bot, as the runtime's surface answers it. */
export interface WebuiRuntimeConnection {
  readonly connectionId: string;
  readonly channel: string;
  readonly agentName: string;
  readonly projectKey: string | null;
  readonly state: "configured" | "authorizing" | "bound" | "error";
  readonly binding?: {
    readonly bindingId: string;
    readonly externalId: string;
    readonly label?: string;
    readonly currentSessionId?: string;
    readonly createdAt: number;
    readonly updatedAt: number;
  };
  readonly errorCode?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * The runtime's channel-bridge surface, as this adapter reads it.
 *
 * The WebUI does not depend on the runtime package that owns the channel bridge, so the shape is
 * declared here and satisfied structurally. The runtime's own surface answers these calls with the
 * same fields, which is what keeps the two in step without a package dependency.
 */
export interface WebuiRuntimeChannelBridge {
  /** The bots this runtime knows, bound or waiting for their authorization. */
  readonly listConnections: () => Promise<{
    readonly connections: readonly WebuiRuntimeConnection[];
  }>;
  /** Creates the bot a create flow is adding, before its platform authorization. */
  readonly prepareConnection?: (request: {
    readonly platform: string;
    readonly agent?: string;
  }) => Promise<{
    readonly ok: boolean;
    readonly connection?: WebuiRuntimeConnection;
    readonly error?: string;
    readonly code?: string;
  }>;
  readonly connect: (request: {
    readonly name: string;
    readonly appId?: string;
    readonly appSecret?: string;
    readonly connectionId?: string;
  }) => Promise<{ readonly ok: boolean; readonly error?: string; readonly code?: string }>;
  /** 解除连接: unbinds one bot, keeping it in the list. */
  readonly disconnectConnection?: (request: {
    readonly connectionId: string;
  }) => Promise<{ readonly ok: boolean; readonly error?: string; readonly code?: string }>;
  /** 删除Bot: removes one bot. */
  readonly deleteConnection?: (request: {
    readonly connectionId: string;
  }) => Promise<{ readonly ok: boolean; readonly error?: string; readonly code?: string }>;
  readonly checkConfig: (request: { readonly agent: string }) => Promise<{
    readonly configured: boolean;
    readonly detail?: string;
  }>;
  readonly getMessageFilter: (request: { readonly agent: string }) => Promise<{
    readonly mode: string;
    readonly includeToolSummary: boolean;
  }>;
  readonly updateMessageFilter: (request: {
    readonly agent: string;
    readonly filter: { readonly mode: string; readonly includeToolSummary: boolean };
  }) => Promise<{ readonly mode: string; readonly includeToolSummary: boolean }>;
  /**
   * The WeChat authorization the 接入 IM create flow shows a QR for, and the read of its state.
   *
   * Both are optional: a host that carries no WeChat adapter refuses them by name instead of
   * answering a QR it never produced.
   */
  readonly startWechatBind?: (request: {
    readonly name: string;
    readonly agent?: string;
    readonly connectionId?: string;
  }) => Promise<{
    readonly ok: boolean;
    readonly sessionId?: string;
    readonly qrImageUrl?: string;
    readonly qrContent?: string;
    readonly error?: string;
    readonly code?: string;
  }>;
  readonly getWechatBindStatus?: (request: {
    readonly sessionId?: string;
    readonly connectionId?: string;
  }) => Promise<{
    readonly status: "pending" | "confirmed" | "expired" | "error";
    readonly connectionId?: string;
    readonly error?: string;
    readonly code?: string;
  }>;
}

/**
 * The host slot that carries the channel bridge.
 *
 * The runtime host publishes the surface as a public member, and a host composed for the browser
 * may hand the same object over under a slot of its own. Both are read, so the adapter works
 * whichever way the host is composed — and a host that carries neither refuses once, here.
 */
interface WebuiChannelBridgeSlot {
  readonly channelBridge?: WebuiRuntimeChannelBridge;
}

/**
 * The six members, already converted.
 *
 * A host may carry them itself (`host-contract.ts` declares the slot for exactly that), or the
 * adapter builds them from the runtime's raw bridge. Both paths end in the same six functions, so
 * the conversion lives in one place either way.
 */
interface WebuiChannelMembers {
  readonly listChannelConnections: () => Promise<WebuiChannelConnectionList>;
  readonly prepareChannelConnection: (
    request: WebuiChannelPrepareRequest,
  ) => Promise<WebuiChannelOperationResult>;
  readonly connectChannel: (
    request: WebuiChannelConnectRequest,
  ) => Promise<WebuiChannelOperationResult>;
  readonly disconnectChannelConnection: (
    request: WebuiChannelConnectionRequest,
  ) => Promise<WebuiChannelOperationResult>;
  readonly deleteChannelConnection: (
    request: WebuiChannelConnectionRequest,
  ) => Promise<WebuiChannelOperationResult>;
  readonly checkChannelConfig: (
    request: WebuiChannelConfigCheckRequest,
  ) => Promise<WebuiChannelConfigCheckResult>;
  readonly getChannelMessageFilter: (request: {
    readonly agent: string;
  }) => Promise<WebuiChannelMessageFilter>;
  readonly updateChannelMessageFilter: (
    request: WebuiChannelMessageFilterRequest,
  ) => Promise<WebuiChannelMessageFilter>;
  readonly startChannelWechatBind: (
    request: WebuiChannelWechatBindStartRequest,
  ) => Promise<WebuiChannelWechatBindStartResult>;
  readonly getChannelWechatBindStatus: (
    request: WebuiChannelWechatBindStatusRequest,
  ) => Promise<WebuiChannelWechatBindStatusResult>;
}

const CHANNEL_MEMBER_NAMES = [
  "listChannelConnections",
  "prepareChannelConnection",
  "connectChannel",
  "disconnectChannelConnection",
  "deleteChannelConnection",
  "checkChannelConfig",
  "getChannelMessageFilter",
  "updateChannelMessageFilter",
] as const;

/**
 * The six members, as one capability.
 *
 * They travel together: the runtime composes them from one channel bridge, so a host that has
 * three of them is broken rather than partial, and refusing all six is the message a client can
 * act on.
 */
function hasAllChannelMembers(candidate: Partial<WebuiChannelMembers>): boolean {
  return CHANNEL_MEMBER_NAMES.every((name) => typeof candidate[name] === "function");
}

/** The members the runtime's raw bridge answers, converted to the wire. */
function membersFromRuntimeBridge(bridge: WebuiRuntimeChannelBridge): WebuiChannelMembers {
  return {
    listChannelConnections: async () => toConnections(await bridge.listConnections()),
    prepareChannelConnection: async (request) => {
      const prepare = bridge.prepareConnection;
      if (!prepare) throw new WebuiResultShapeError("the host carries no IM bot route");
      const outcome = await prepare({
        platform: request.platform,
        ...(request.agent === undefined ? {} : { agent: request.agent }),
      });
      return toOperationResult(outcome);
    },
    connectChannel: async (request) =>
      toOperationResult(
        await bridge.connect({
          name: request.name,
          ...(request.appId === undefined ? {} : { appId: request.appId }),
          ...(request.appSecret === undefined ? {} : { appSecret: request.appSecret }),
          ...(request.connectionId === undefined ? {} : { connectionId: request.connectionId }),
        }),
      ),
    disconnectChannelConnection: async (request) => {
      const disconnect = bridge.disconnectConnection;
      if (!disconnect) throw new WebuiResultShapeError("the host carries no IM bot route");
      return toOperationResult(await disconnect({ connectionId: request.connectionId }));
    },
    deleteChannelConnection: async (request) => {
      const remove = bridge.deleteConnection;
      if (!remove) throw new WebuiResultShapeError("the host carries no IM bot route");
      return toOperationResult(await remove({ connectionId: request.connectionId }));
    },
    checkChannelConfig: async (request) => {
      const result = await bridge.checkConfig({ agent: request.agent });
      const detail = optionalText(result.detail);
      return {
        configured: requiredBoolean(result.configured, "configured"),
        ...(detail === undefined ? {} : { detail }),
      };
    },
    getChannelMessageFilter: async (request) =>
      toMessageFilter(await bridge.getMessageFilter({ agent: request.agent })),
    updateChannelMessageFilter: async (request) =>
      toMessageFilter(
        await bridge.updateMessageFilter({
          agent: request.agent,
          filter: {
            mode: request.filter.mode,
            includeToolSummary: request.filter.includeToolSummary,
          },
        }),
      ),
    startChannelWechatBind: async (request) => {
      const start = bridge.startWechatBind;
      if (!start) throw new WebuiResultShapeError("the host carries no WeChat authorization route");
      const outcome = await start({
        name: request.name,
        ...(request.agent === undefined ? {} : { agent: request.agent }),
        ...(request.connectionId === undefined ? {} : { connectionId: request.connectionId }),
      });
      return {
        ok: outcome.ok === true,
        ...(outcome.sessionId === undefined ? {} : { sessionId: outcome.sessionId }),
        ...(outcome.qrImageUrl === undefined ? {} : { qrImageUrl: outcome.qrImageUrl }),
        ...(outcome.qrContent === undefined ? {} : { qrContent: outcome.qrContent }),
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
        ...(outcome.code === undefined ? {} : { code: outcome.code }),
      };
    },
    getChannelWechatBindStatus: async (request) => {
      const read = bridge.getWechatBindStatus;
      if (!read) throw new WebuiResultShapeError("the host carries no WeChat authorization route");
      const outcome = await read({
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        ...(request.connectionId === undefined ? {} : { connectionId: request.connectionId }),
      });
      return {
        status: outcome.status,
        ...(outcome.connectionId === undefined ? {} : { connectionId: outcome.connectionId }),
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
        ...(outcome.code === undefined ? {} : { code: outcome.code }),
      };
    },
  };
}

/**
 * The six members, from whichever seam the host offers.
 *
 * A host that carries the members itself wins; a host that carries only the runtime's bridge
 * gets them converted here; a host that carries neither refuses with one stated error, so the
 * browser never reads an absent bridge as "no IM client is bound".
 */
/**
 * The refusal a host without a WeChat adapter answers the authorization with.
 *
 * It is named rather than swallowed: a create flow that cannot produce a QR says so, instead of
 * showing an empty square as if the authorization had started.
 */
async function refuseWechatAuthorization(): Promise<never> {
  throw new WebuiResultShapeError("the host carries no WeChat authorization route");
}

function requireChannelMembers(host: WebuiRuntimeHostHandle): WebuiChannelMembers {
  const own = host as unknown as Partial<WebuiChannelMembers>;
  // The two authorization members are newer than the six the host may carry itself, so a host that
  // carries the six without them still serves the six and refuses only the authorization.
  if (hasAllChannelMembers(own)) {
    return {
      ...(own as WebuiChannelMembers),
      startChannelWechatBind:
        own.startChannelWechatBind ?? refuseWechatAuthorization,
      getChannelWechatBindStatus:
        own.getChannelWechatBindStatus ?? refuseWechatAuthorization,
    };
  }
  const slot = host as unknown as WebuiChannelBridgeSlot;
  const bridge = requireHostSlot(
    slot.channelBridge ??
      (host.apiHost as unknown as WebuiChannelBridgeSlot).channelBridge,
    "the channel bridge",
  );
  return membersFromRuntimeBridge(bridge);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WebuiResultShapeError(`an IM channel field was not readable: ${field}`);
  }
  return value;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new WebuiResultShapeError(`an IM channel field was not readable: ${field}`);
  }
  return value;
}

const MESSAGE_FILTER_MODES: readonly WebuiChannelMessageFilterMode[] = ["result", "full"];

function toMessageFilter(
  filter: { readonly mode: string; readonly includeToolSummary: boolean },
): WebuiChannelMessageFilter {
  const mode = filter.mode;
  if (!MESSAGE_FILTER_MODES.includes(mode as WebuiChannelMessageFilterMode)) {
    throw new WebuiResultShapeError(`an IM channel field was not readable: filter.mode`);
  }
  return {
    mode: mode as WebuiChannelMessageFilterMode,
    includeToolSummary: requiredBoolean(filter.includeToolSummary, "filter.includeToolSummary"),
  };
}

const CONNECTION_STATES: readonly WebuiRuntimeConnection["state"][] = [
  "configured",
  "authorizing",
  "bound",
  "error",
];

/** The runtime's bot list, converted field by field. */
function toConnections(list: {
  readonly connections: readonly WebuiRuntimeConnection[];
}): WebuiChannelConnectionList {
  if (!Array.isArray(list.connections)) {
    throw new WebuiResultShapeError("an IM bot list was not readable");
  }
  return {
    connections: list.connections.map((connection) => toConnection(connection)),
  };
}

function toConnection(connection: WebuiRuntimeConnection): WebuiChannelConnection {
  const state = connection.state;
  if (!CONNECTION_STATES.includes(state)) {
    throw new WebuiResultShapeError("an IM bot field was not readable: state");
  }
  const binding = connection.binding;
  const label = binding ? optionalText(binding.label) : undefined;
  const currentSessionId = binding ? optionalText(binding.currentSessionId) : undefined;
  const errorCode = optionalText(connection.errorCode);
  return {
    connectionId: requiredText(connection.connectionId, "connectionId"),
    channel: requiredText(connection.channel, "channel"),
    agentName: requiredText(connection.agentName, "agentName"),
    projectKey: typeof connection.projectKey === "string" ? connection.projectKey : null,
    state,
    ...(binding
      ? {
          binding: {
            bindingId: requiredText(binding.bindingId, "binding.bindingId"),
            externalId: requiredText(binding.externalId, "binding.externalId"),
            ...(label === undefined ? {} : { label }),
            ...(currentSessionId === undefined ? {} : { currentSessionId }),
          },
        }
      : {}),
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

/**
 * The runtime's verdict on one mutation, as the wire reports it.
 *
 * The runtime's own code comes first when it sent one, because that code is what the rest of the
 * runtime reads the refusal by; the message follows it so the browser can still say what happened.
 */
function toOperationResult(outcome: {
  readonly ok: boolean;
  readonly error?: string;
  readonly code?: string;
}): WebuiChannelOperationResult {
  const code = optionalText(outcome.code);
  const error = optionalText(outcome.error);
  const detail = code === undefined ? error : error === undefined ? code : `${code}: ${error}`;
  return {
    success: outcome.ok === true,
    ...(detail === undefined ? {} : { error: detail }),
  };
}

export function createChannelAdapter(host: WebuiRuntimeHostHandle): Pick<
  WebuiHarnessPort,
  | "listChannelConnections"
  | "prepareChannelConnection"
  | "connectChannel"
  | "disconnectChannelConnection"
  | "deleteChannelConnection"
  | "checkChannelConfig"
  | "getChannelMessageFilter"
  | "updateChannelMessageFilter"
  | "startChannelWechatBind"
  | "getChannelWechatBindStatus"
> {
  return {
    async listChannelConnections(): Promise<WebuiChannelConnectionList> {
      return requireChannelMembers(host).listChannelConnections();
    },

    async prepareChannelConnection(
      request: WebuiChannelPrepareRequest,
    ): Promise<WebuiChannelOperationResult> {
      return requireChannelMembers(host).prepareChannelConnection(request);
    },

    async connectChannel(request): Promise<WebuiChannelOperationResult> {
      return requireChannelMembers(host).connectChannel(request);
    },

    async disconnectChannelConnection(
      request: WebuiChannelConnectionRequest,
    ): Promise<WebuiChannelOperationResult> {
      return requireChannelMembers(host).disconnectChannelConnection(request);
    },

    async deleteChannelConnection(
      request: WebuiChannelConnectionRequest,
    ): Promise<WebuiChannelOperationResult> {
      return requireChannelMembers(host).deleteChannelConnection(request);
    },

    async checkChannelConfig(request): Promise<WebuiChannelConfigCheckResult> {
      return requireChannelMembers(host).checkChannelConfig(request);
    },

    async getChannelMessageFilter(request): Promise<WebuiChannelMessageFilter> {
      return requireChannelMembers(host).getChannelMessageFilter(request);
    },

    async updateChannelMessageFilter(request): Promise<WebuiChannelMessageFilter> {
      return requireChannelMembers(host).updateChannelMessageFilter(request);
    },
    async startChannelWechatBind(
      request: WebuiChannelWechatBindStartRequest,
    ): Promise<WebuiChannelWechatBindStartResult> {
      return requireChannelMembers(host).startChannelWechatBind(request);
    },
    async getChannelWechatBindStatus(
      request: WebuiChannelWechatBindStatusRequest,
    ): Promise<WebuiChannelWechatBindStatusResult> {
      return requireChannelMembers(host).getChannelWechatBindStatus(request);
    },
  };
}
