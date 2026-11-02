// The 接入 IM business's transport seam.
//
// The members are optional on purpose: a build whose transport does not carry them yet leaves a
// member `undefined`, and the owner turns that into one stated refusal instead of a crash or an
// empty list that reads as "no IM bot exists".
//
// The request and response types are the shared wire DTOs. This file may not name the runtime's
// connection views — `shared/contracts/channel.ts` is what the browser is allowed to know, and the
// adapter behind the harness is where the conversion happens.
import type {
  WebuiChannelConfigCheckRequest,
  WebuiChannelConfigCheckResult,
  WebuiChannelConnectRequest,
  WebuiChannelConnectionList,
  WebuiChannelConnectionRequest,
  WebuiChannelMessageFilter,
  WebuiChannelMessageFilterRequest,
  WebuiChannelOperationResult,
  WebuiChannelPrepareRequest,
  WebuiChannelWechatBindStartRequest,
  WebuiChannelWechatBindStartResult,
  WebuiChannelWechatBindStatusRequest,
  WebuiChannelWechatBindStatusResult,
} from "../../../../shared/contracts/channel.js";

export interface ChannelPort {
  /** The bots this runtime knows, bound or waiting for their authorization. */
  readonly listChannelConnections?: () => Promise<WebuiChannelConnectionList>;
  /** Creates the bot a create flow is adding, before its platform authorization. */
  readonly prepareChannelConnection?: (
    request: WebuiChannelPrepareRequest,
  ) => Promise<WebuiChannelOperationResult>;
  readonly connectChannel?: (
    request: WebuiChannelConnectRequest,
  ) => Promise<WebuiChannelOperationResult>;
  /** 解除连接: unbinds one bot, keeping it in the list. */
  readonly disconnectChannelConnection?: (
    request: WebuiChannelConnectionRequest,
  ) => Promise<WebuiChannelOperationResult>;
  /** 删除Bot: removes one bot. */
  readonly deleteChannelConnection?: (
    request: WebuiChannelConnectionRequest,
  ) => Promise<WebuiChannelOperationResult>;
  readonly checkChannelConfig?: (
    request: WebuiChannelConfigCheckRequest,
  ) => Promise<WebuiChannelConfigCheckResult>;
  readonly getChannelMessageFilter?: (request: {
    readonly agent: string;
  }) => Promise<WebuiChannelMessageFilter>;
  readonly updateChannelMessageFilter?: (
    request: WebuiChannelMessageFilterRequest,
  ) => Promise<WebuiChannelMessageFilter>;
  /**
   * Starts the WeChat authorization one bot's card shows a QR for.
   *
   * The runtime's own route (`wechat/bind/start`) already answers it, and it accepts the bot's
   * connection when the bot already exists; this member is how the browser reaches it.
   */
  readonly startChannelWechatBind?: (
    request: WebuiChannelWechatBindStartRequest,
  ) => Promise<WebuiChannelWechatBindStartResult>;
  /** Reads one WeChat authorization's state. */
  readonly getChannelWechatBindStatus?: (
    request: WebuiChannelWechatBindStatusRequest,
  ) => Promise<WebuiChannelWechatBindStatusResult>;
}
