// Wire contract record: every exported
// declaration below records its wire purpose, its producer and its
// consumers, verified against the tree. Documentation only.
//
// | Declaration | Wire purpose | Producer | Consumers |
// | --- | --- | --- | --- |
// | `WebuiChannelClient` | One IM client the runtime has bound, as the 接入 IM tab lists it. | Runtime channel-bridge `GET /channel-bridge/status` (via `runtime/harness/channel.ts`). | `runtime/harness/channel.ts`; the 接入 IM tab. |
// | `WebuiChannelStatus` | The whole channel-bridge status snapshot. | Runtime channel-bridge `GET /channel-bridge/status`. | `runtime/harness/channel.ts`; the 接入 IM tab. |
// | `WebuiChannelConnectRequest` | Body for binding one IM client. | The 接入 IM tab's connect form. | `runtime/harness/channel.ts`. |
// | `WebuiChannelDisconnectRequest` | Body for unbinding one IM client. | The 接入 IM tab's disconnect action. | `runtime/harness/channel.ts`. |
// | `WebuiChannelConfigCheckRequest` | Which agent's channel configuration to check. | The 接入 IM tab's per-agent check. | `runtime/harness/channel.ts`. |
// | `WebuiChannelConfigCheckResult` | Whether the agent's IM channel is configured. | Runtime channel-bridge `GET /channel-bridge/config-check?agent=`. | `runtime/harness/channel.ts`; the 接入 IM tab. |
// | `WebuiChannelMessageFilter` | How much of a turn an IM client receives. | Runtime channel-bridge `GET`/`PUT /channel-bridge/message-filter/<agent>`. | `runtime/harness/channel.ts`; the 接入 IM tab. |
// | `WebuiChannelMessageFilterRequest` | Which agent's filter to read or write. | The 接入 IM tab's filter editor. | `runtime/harness/channel.ts`. |
//
// The runtime's own channel types (`LocalChannelClient`, `LocalChannelMessageFilter`, …) are
// deliberately absent: `src/shared` may not import them, so the harness adapter converts. The
// shape that survives the conversion is the one Desktop's own IM client already speaks
// (`channels/infra.ts` → `routeLocalChannelBridgeInfraApi`).

/** The IM platforms Desktop's channel bridge ships an adapter for. */
export type WebuiChannelPlatform = "feishu" | "wechat" | "telegram";

/**
 * One IM client known to the runtime.
 *
 * The runtime keys clients by **name**, not by (platform, name): Desktop's IM client sends
 * `{name, appId?, appSecret?}` to connect and `{name, clearCredentials, platform?}` to
 * disconnect, so the name is the identity a user types.
 */
export interface WebuiChannelClient {
  readonly name: string;
  readonly platform: WebuiChannelPlatform | (string & {});
  /** The agent this client is bound to, when the runtime reports one. */
  readonly agentName?: string;
}

export interface WebuiChannelStatus {
  readonly clients: readonly WebuiChannelClient[];
}

/**
 * The outcome of a channel mutation.
 *
 * Desktop's IM client resolves the runtime's connect/disconnect responses directly; the WebUI
 * turns them into one shape so the tab can render a failure without knowing which route produced
 * it. `error` carries the runtime's own code when it sent one.
 */
export interface WebuiChannelOperationResult {
  readonly success: boolean;
  readonly error?: string;
}

export interface WebuiChannelConnectRequest {
  readonly name: string;
  /** Feishu app id; Desktop's IM client sends it only when the user filled one in. */
  readonly appId?: string;
  /** Feishu app secret; never echoed back to the browser. */
  readonly appSecret?: string;
}

export interface WebuiChannelDisconnectRequest {
  readonly name: string;
  readonly clearCredentials?: boolean;
  readonly platform?: string;
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
