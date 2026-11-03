// Wire contract record: every exported
// declaration below records its wire purpose, its producer and its
// consumers, verified against the tree. Documentation only.
//
// | Declaration | Wire purpose | Producer | Consumers |
// | --- | --- | --- | --- |
// | `WebuiChannelConnection` | One IM bot the runtime knows, bound or waiting for its authorization, as the 接入 IM tab lists it. | Runtime channel-bridge `GET /channel-bridge/connections` (via `runtime/harness/channel.ts`). | `runtime/harness/channel.ts`; the 接入 IM tab. |
// | `WebuiChannelConnectionList` | The whole bot list. | Runtime channel-bridge `GET /channel-bridge/connections`. | `runtime/harness/channel.ts`; the 接入 IM tab. |
// | `WebuiChannelPrepareRequest` | The platform a create flow is adding a bot for. | The 接入 IM tab's create menu. | `runtime/harness/channel.ts`. |
// | `WebuiChannelConnectRequest` | Body for binding one IM client. | The 接入 IM tab's Feishu credential form. | `runtime/harness/channel.ts`. |
// | `WebuiChannelConnectionRequest` | Which bot a mutation acts on. | The 接入 IM tab's 解除连接 and 删除Bot actions. | `runtime/harness/channel.ts`. |
// | `WebuiChannelConfigCheckRequest` | Which agent's channel configuration to check. | The 接入 IM tab's per-agent check. | `runtime/harness/channel.ts`. |
// | `WebuiChannelConfigCheckResult` | Whether the agent's IM channel is configured. | Runtime channel-bridge `GET /channel-bridge/config-check?agent=`. | `runtime/harness/channel.ts`; the 接入 IM tab. |
// | `WebuiChannelMessageFilter` | How much of a turn an IM client receives. | Runtime channel-bridge `GET`/`PUT /channel-bridge/message-filter/<agent>`. | `runtime/harness/channel.ts`; the 接入 IM tab. |
// | `WebuiChannelMessageFilterRequest` | Which agent's filter to read or write. | The 接入 IM tab's filter editor. | `runtime/harness/channel.ts`. |
//
// The runtime's own channel types (`LocalImConnectionView`, `LocalChannelMessageFilter`, …) are
// deliberately absent: `src/shared` may not import them, so the harness adapter converts. The
// shape that survives the conversion is the one the channel-bridge surface already speaks
// (`channel-bridge-surface.ts` → `GET /channel-bridge/connections`).

/** The IM platforms the channel bridge ships an adapter for. */
export type WebuiChannelPlatform = "feishu" | "wechat" | "telegram";

/**
 * Where one bot stands.
 *
 * `bound` is the only state in which the bot is bound to its platform. `configured` is a bot that
 * exists and has not been authorized yet, `authorizing` one whose QR is on screen, and `error` one
 * whose last authorization failed. The 接入 IM tab draws two card shapes from these states:
 * bound, and not-yet-bound.
 */
export type WebuiChannelConnectionState = "configured" | "authorizing" | "bound" | "error";

/** One IM bot the runtime knows — bound, or waiting for its authorization. */
export interface WebuiChannelConnection {
  readonly connectionId: string;
  readonly channel: WebuiChannelPlatform | (string & {});
  readonly agentName: string;
  /** Null means the user explicitly chose no project. */
  readonly projectKey: string | null;
  readonly state: WebuiChannelConnectionState;
  /** The platform binding, once the bot is bound. */
  readonly binding?: {
    readonly bindingId: string;
    /** The transport client the platform knows this bot by; the message filter is keyed by it. */
    readonly externalId: string;
    /** The platform's own display name for the bot, when the adapter knows one. */
    readonly label?: string;
    readonly currentSessionId?: string;
  };
  readonly errorCode?: string;
}

export interface WebuiChannelConnectionList {
  readonly connections: readonly WebuiChannelConnection[];
}

/**
 * The outcome of a channel mutation.
 *
 * The runtime's connect/disconnect responses are turned into one shape so the tab can render a
 * failure without knowing which route produced it. `error` carries the runtime's own code when
 * it sent one.
 */
export interface WebuiChannelOperationResult {
  readonly success: boolean;
  readonly error?: string;
}

export interface WebuiChannelConnectRequest {
  readonly name: string;
  /** Feishu app id; sent only when the user filled one in. */
  readonly appId?: string;
  /** Feishu app secret; never echoed back to the browser. */
  readonly appSecret?: string;
  /** The prepared bot this bind belongs to. */
  readonly connectionId?: string;
}

/** The bot a create flow is adding, and the platform it is adding it for. */
export interface WebuiChannelPrepareRequest {
  readonly platform: WebuiChannelPlatform | (string & {});
  /** The agent the bot talks to, when the caller names one. */
  readonly agent?: string;
}

/** Which bot a mutation acts on. */
export interface WebuiChannelConnectionRequest {
  readonly connectionId: string;
}

export interface WebuiChannelConfigCheckRequest {
  readonly agent: string;
}

export interface WebuiChannelConfigCheckResult {
  readonly configured: boolean;
  readonly detail?: string;
}

/** How much of a turn the IM client receives: the final result, or the full transcript. */
export type WebuiChannelMessageFilterMode = "result" | "full";

export interface WebuiChannelMessageFilter {
  readonly mode: WebuiChannelMessageFilterMode;
  readonly includeToolSummary: boolean;
}

export interface WebuiChannelMessageFilterRequest {
  readonly agent: string;
  readonly filter: WebuiChannelMessageFilter;
}

/**
 * Starting the WeChat authorization the 接入 IM create flow shows a QR for.
 *
 * The runtime's own route answers with the QR it produced and the session the authorization is
 * filed under; the status route reads that session back.
 */
export interface WebuiChannelWechatBindStartRequest {
  /** The bot's name. The runtime keys a WeChat bot by the agent behind it. */
  readonly name: string;
  /** The agent the bot is bound to, when the caller names one. */
  readonly agent?: string;
  /** The bot this authorization belongs to, when the bot already exists. */
  readonly connectionId?: string;
}

export interface WebuiChannelWechatBindStartResult {
  readonly ok: boolean;
  /** The session the authorization is filed under. */
  readonly sessionId?: string;
  /** The QR image, when the runtime produced one. */
  readonly qrImageUrl?: string;
  /** The text the QR carries, when the runtime produced text rather than an image. */
  readonly qrContent?: string;
  readonly error?: string;
  readonly code?: string;
}

/** Which authorization to read. The runtime files it under a session, and a connection once bound. */
export interface WebuiChannelWechatBindStatusRequest {
  readonly sessionId?: string;
  readonly connectionId?: string;
}

export interface WebuiChannelWechatBindStatusResult {
  readonly status: "pending" | "confirmed" | "expired" | "error";
  readonly connectionId?: string;
  readonly error?: string;
  readonly code?: string;
}
