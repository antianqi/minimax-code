// The 接入 IM panel's projection: wire DTOs in, display rows out.
//
// Pure functions, so the wording of every row is testable without a DOM. The panel renders what
// this module returns and decides nothing itself.
//
// Three honesty rules live here:
//
//   * **A platform is named, never guessed.** The runtime reports the platform of every bot it
//     knows; a platform this module does not know is printed as it came, because a wrong "微信"
//     would send the reader to the wrong app.
//   * **Bound is a state, not an assumption.** The panel draws two card shapes from the bot's own
//     state: a bound bot carries the association's bound copy and 解除连接, and a bot whose
//     authorization has not finished carries the unbound copy and the QR. A row is `bound` only
//     when the runtime says so, because a bot that is waiting for its QR scan is not bound.
//   * **A section with no route behind it says so.** The 接入 IM pane has sections the
//     runtime's routes do not cover — the Agent and working-directory binding writes — and they
//     carry their own copy and are marked as not wired, rather than shown as if they
//     worked.
import type {
  WebuiChannelConfigCheckResult,
  WebuiChannelConnection,
  WebuiChannelConnectionState,
  WebuiChannelMessageFilterMode,
} from "../../../../shared/contracts/channel.js";

/** The platform labels the 接入 IM pane shows. */
export const WEBUI_CHANNEL_PLATFORM_LABELS: Readonly<Record<string, string>> = {
  wechat: "微信",
  feishu: "飞书",
  telegram: "Telegram",
};

/** The marker for a section the runtime has no route behind. */
export const WEBUI_CHANNEL_NOT_WIRED = "Disabled (not yet wired)";

export const WEBUI_CHANNEL_EMPTY_TEXT = "还没有接入任何 IM 客户端。";
export const WEBUI_CHANNEL_LOADING_TEXT = "正在读取 IM 接入列表…";
export const WEBUI_CHANNEL_DEFAULT_AGENT_LABEL = "默认";

/** The copy for the sections the 接入 IM pane shows. */
export const WEBUI_CHANNEL_SECTION_BIND = "绑定机器人";
export const WEBUI_CHANNEL_STATE_BOUND = "已绑定";
export const WEBUI_CHANNEL_STATE_UNBOUND = "未绑定";
export const WEBUI_CHANNEL_SECTION_BIND_QR = "扫描二维码绑定";
export const WEBUI_CHANNEL_SECTION_BIND_QR_REFRESH = "刷新二维码";
export const WEBUI_CHANNEL_SECTION_BIND_QR_DESCRIPTION = "微信扫码授权以绑定MiniMax Code";
export const WEBUI_CHANNEL_SECTION_BIND_QR_HINT = "机器人将自动绑定";
export const WEBUI_CHANNEL_SECTION_BIND_BOUND_WECHAT = "已关联微信，可解除或新建 bot";
export const WEBUI_CHANNEL_SECTION_BIND_BOUND_FEISHU = "已关联飞书，可解除或新建 bot";
export const WEBUI_CHANNEL_SECTION_BIND_BOUND_TELEGRAM = "已关联 Telegram，可解除或新建 bot";
export const WEBUI_CHANNEL_SECTION_UNBIND = "解除连接";
export const WEBUI_CHANNEL_SECTION_AGENT = "选择 Agent";
export const WEBUI_CHANNEL_SECTION_AGENT_DESCRIPTION = "用不同的 Agent 对话";
export const WEBUI_CHANNEL_SECTION_WORKSPACE = "工作目录";
export const WEBUI_CHANNEL_SECTION_WORKSPACE_DESCRIPTION = "对话信息默认保留的位置";
export const WEBUI_CHANNEL_SECTION_WORKSPACE_EMPTY = "未选项目";
export const WEBUI_CHANNEL_SECTION_DELETE = "删除Bot";
export const WEBUI_CHANNEL_SECTION_DELETE_DESCRIPTION = "从列表移除这个 Bot";
export const WEBUI_CHANNEL_SECTION_DELETE_ACTION = "删除";
export const WEBUI_CHANNEL_SECTION_DELETE_CONFIRM_TITLE = "删除这个 Bot？";
export const WEBUI_CHANNEL_SECTION_DELETE_CONFIRM_DESCRIPTION =
  "删除后将移除此 IM Bot，历史对话会保留。";
/**
 * The button that starts a new IM bot.
 *
 * The list's own action, under the rows. It opens the platform menu, one entry
 * per platform.
 */
export const WEBUI_CHANNEL_CREATE_BOT_LABEL = "创建 IM Bot";

/**
 * The platforms the create menu offers.
 *
 * The runtime binds 微信 and 飞书. Each entry carries its icon and label.
 */
export interface WebuiChannelAddOption {
  readonly key: "wechat" | "feishu";
  /** The menu row's label. */
  readonly label: string;
  /** The card's association title for this platform. */
  readonly title: string;
  /** The line under the QR, when the platform shows one. */
  readonly qrDescription: string;
}

export const WEBUI_CHANNEL_ADD_OPTIONS: readonly WebuiChannelAddOption[] = [
  {
    key: "wechat",
    label: "微信",
    title: "扫码绑定微信",
    qrDescription: "微信扫码授权以绑定MiniMax Code",
  },
  {
    key: "feishu",
    label: "飞书",
    title: "扫码绑定飞书",
    qrDescription: "通过扫码或链接完成飞书授权",
  },
];

/** The copy while the authorization is being created. */
export const WEBUI_CHANNEL_AUTHORIZATION_STARTING = "正在创建授权…";
/** The copy for the pairing code the QR carries. */
export const WEBUI_CHANNEL_AUTHORIZATION_ACTIVE = "请完成授权，完成后将自动绑定。";
/** The action that starts the authorization over. */
export const WEBUI_CHANNEL_RENEW_AUTHORIZATION = "刷新";
/** The name the pane gives the WeChat bot. */
export const WEBUI_CHANNEL_WECHAT_BOT_NAME = "ClawBot";
/** The name a bot that carries no binding name gets. */
export const WEBUI_CHANNEL_NEW_BOT_NAME = "新 Bot";
export const WEBUI_CHANNEL_SECTION_FILTER = "附带工具调用";
export const WEBUI_CHANNEL_SECTION_FILTER_DESCRIPTION = "在每条消息末尾附上工具调用列表。";

/** The two message-filter modes, as the pane names them. */
export const WEBUI_CHANNEL_FILTER_MODE_RESULT = "仅输出结果";
export const WEBUI_CHANNEL_FILTER_MODE_FULL = "完整输出";

export const WEBUI_CHANNEL_CONFIGURED_LABEL = "已配置";
export const WEBUI_CHANNEL_NOT_CONFIGURED_LABEL = "未配置";
export const WEBUI_CHANNEL_CONFIG_UNKNOWN_LABEL = "未读取";

export interface WebuiChannelRow {
  /** The bot's durable identity. */
  readonly connectionId: string;
  readonly platform: string;
  readonly platformLabel: string;
  readonly agentLabel: string;
  readonly selected: boolean;
  /**
   * Whether the bot is already bound to its platform.
   *
   * The panel draws two card shapes from this: a bound bot carries the association's bound copy and
   * the 解除连接 action and shows no QR; a bot that is still waiting for its authorization carries
   * the unbound copy, the 刷新二维码 action and the QR itself.
   */
  readonly bound: boolean;
  /** The state the card's header shows. */
  readonly stateLabel: string;
  /**
   * The name the list and the detail header show.
   *
   * A WeChat bot is named `ClawBot`, a bound bot by its binding's label (then its transport
   * identity), and a bot with neither `新 Bot`.
   */
  readonly botName: string;
  /** The runtime's own failure code for the bot's last authorization, when it has one. */
  readonly errorCode?: string;
}

/** The platform's label, or the platform as it came when this module does not know it. */
export function webuiChannelPlatformLabel(platform: string): string {
  return WEBUI_CHANNEL_PLATFORM_LABELS[platform] ?? platform;
}

/**
 * The order the platform catalogue lists bots in.
 *
 * The list is grouped by platform rather than by creation time, so the first row — the one the
 * card opens on — is the most familiar platform. The runtime's own order stays inside a platform.
 */
export const WEBUI_CHANNEL_PLATFORM_ORDER: readonly string[] = ["wechat", "feishu", "telegram"];

function platformRank(platform: string): number {
  const index = WEBUI_CHANNEL_PLATFORM_ORDER.indexOf(platform);
  return index === -1 ? WEBUI_CHANNEL_PLATFORM_ORDER.length : index;
}

/** One row per bot, grouped by platform in the catalogue's order. */
export function webuiChannelRows(
  connections: readonly WebuiChannelConnection[],
  selectedId?: string,
): WebuiChannelRow[] {
  const ordered = connections
    .map((connection, index) => ({ connection, index }))
    .sort(
      (left, right) =>
        platformRank(left.connection.channel) - platformRank(right.connection.channel) ||
        left.index - right.index,
    )
    .map((entry) => entry.connection);
  return ordered.map((connection) => ({
    connectionId: connection.connectionId,
    platform: connection.channel,
    platformLabel: webuiChannelPlatformLabel(connection.channel),
    agentLabel: connection.agentName || WEBUI_CHANNEL_DEFAULT_AGENT_LABEL,
    selected: connection.connectionId === selectedId,
    botName: webuiChannelBotName(connection),
    bound: connection.state === "bound",
    stateLabel: webuiChannelStateLabel(connection.state),
    ...(connection.errorCode === undefined ? {} : { errorCode: connection.errorCode }),
  }));
}

/** The state the card's header shows. There is one word for every unbound shape. */
export function webuiChannelStateLabel(state: WebuiChannelConnectionState): string {
  return state === "bound" ? WEBUI_CHANNEL_STATE_BOUND : WEBUI_CHANNEL_STATE_UNBOUND;
}

/**
 * The bot's name, as the list names it.
 *
 * A WeChat bot is always `ClawBot`; every other bot carries its binding's label, then the
 * transport identity the platform knows it by, and a bot with neither is `新 Bot`.
 */
export function webuiChannelBotName(connection: WebuiChannelConnection): string {
  if (connection.channel === "wechat") return WEBUI_CHANNEL_WECHAT_BOT_NAME;
  const label = connection.binding?.label?.trim();
  if (label) return label;
  const externalId = connection.binding?.externalId.trim();
  if (externalId) return externalId;
  return WEBUI_CHANNEL_NEW_BOT_NAME;
}

/**
 * The working-directory slot's value.
 *
 * The runtime stores the project a bot's conversations belong to, or null for "the user chose no
 * project". Only the key travels over the wire, so that is what is shown — a display name would
 * have to be invented here.
 */
export function webuiChannelProjectLabel(projectKey: string | null): string {
  return projectKey === null || projectKey.trim() === ""
    ? WEBUI_CHANNEL_SECTION_WORKSPACE_EMPTY
    : projectKey;
}

/** The key the message filter is stored under: the bot's transport identity, once it is bound. */
export function webuiChannelFilterKey(connection: WebuiChannelConnection): string | undefined {
  return connection.binding?.externalId;
}

/**
 * The association's description for a bot that is already bound to a platform.
 *
 * The association says which platform is bound, so a reader knows what 解除连接 will undo.
 */
export function webuiChannelAssociationLabel(platform: string): string {
  if (platform === "wechat") return WEBUI_CHANNEL_SECTION_BIND_BOUND_WECHAT;
  if (platform === "feishu") return WEBUI_CHANNEL_SECTION_BIND_BOUND_FEISHU;
  if (platform === "telegram") return WEBUI_CHANNEL_SECTION_BIND_BOUND_TELEGRAM;
  return WEBUI_CHANNEL_SECTION_BIND_QR;
}

/** Whether the selected client's agent has an IM channel configured on this host. */
export function webuiChannelConfigLabel(config: WebuiChannelConfigCheckResult | undefined): string {
  if (!config) return WEBUI_CHANNEL_CONFIG_UNKNOWN_LABEL;
  return config.configured ? WEBUI_CHANNEL_CONFIGURED_LABEL : WEBUI_CHANNEL_NOT_CONFIGURED_LABEL;
}

/** How much of a turn the IM client receives. */
export function webuiChannelFilterModeLabel(mode: WebuiChannelMessageFilterMode): string {
  return mode === "full" ? WEBUI_CHANNEL_FILTER_MODE_FULL : WEBUI_CHANNEL_FILTER_MODE_RESULT;
}
