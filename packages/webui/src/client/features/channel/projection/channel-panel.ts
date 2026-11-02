// The 接入 IM panel's projection: wire DTOs in, display rows out.
//
// Pure functions, so the wording of every row is testable without a DOM. The panel renders what
// this module returns and decides nothing itself.
//
// Two honesty rules live here:
//
//   * **A platform is named, never guessed.** The runtime reports the platform of every client it
//     knows; a platform this module does not know is printed as it came, because a wrong "微信"
//     would send the reader to the wrong app.
//   * **A section with no route behind it says so.** The Desktop's 接入 IM pane has four sections
//     and the runtime's routes cover two of them. The other two carry the Desktop's own copy and
//     are marked as not wired, rather than shown as if they worked.
import type {
  WebuiChannelClient,
  WebuiChannelConfigCheckResult,
  WebuiChannelMessageFilterMode,
} from "../../../../shared/contracts/channel.js";

/** The platform labels Desktop's 接入 IM pane shows. */
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

/** The Desktop's copy for the sections the 接入 IM pane shows. */
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
 * The Desktop's `im_connect.create_im_bot`: the list's own action, under the rows.
 */
export const WEBUI_CHANNEL_CREATE_BOT_LABEL = "创建 IM Bot";
/** The name the Desktop gives the WeChat bot. */
export const WEBUI_CHANNEL_WECHAT_BOT_NAME = "ClawBot";
/** The name a bot that carries no binding name gets. */
export const WEBUI_CHANNEL_NEW_BOT_NAME = "新 Bot";
export const WEBUI_CHANNEL_SECTION_FILTER = "附带工具调用";
export const WEBUI_CHANNEL_SECTION_FILTER_DESCRIPTION = "在每条消息末尾附上工具调用列表。";

/** The two message-filter modes, as the Desktop names them. */
export const WEBUI_CHANNEL_FILTER_MODE_RESULT = "仅输出结果";
export const WEBUI_CHANNEL_FILTER_MODE_FULL = "完整输出";

export const WEBUI_CHANNEL_CONFIGURED_LABEL = "已配置";
export const WEBUI_CHANNEL_NOT_CONFIGURED_LABEL = "未配置";
export const WEBUI_CHANNEL_CONFIG_UNKNOWN_LABEL = "未读取";

export interface WebuiChannelRow {
  /** The IM client's own name — the identity the runtime stores the binding under. */
  readonly name: string;
  readonly platform: string;
  readonly platformLabel: string;
  readonly agentLabel: string;
  readonly selected: boolean;
  /**
   * The name the list and the detail header show.
   *
   * The Desktop names a WeChat bot `ClawBot` and falls back to the binding's own label, and
   * to `新 Bot` when it has none. The runtime's client name is this client's binding label.
   */
  readonly botName: string;
}

/** The platform's label, or the platform as it came when this module does not know it. */
export function webuiChannelPlatformLabel(platform: string): string {
  return WEBUI_CHANNEL_PLATFORM_LABELS[platform] ?? platform;
}

/** One row per bound IM client, in the runtime's own order. */
export function webuiChannelRows(
  clients: readonly WebuiChannelClient[],
  selectedName?: string,
): WebuiChannelRow[] {
  return clients.map((client) => ({
    name: client.name,
    platform: client.platform,
    platformLabel: webuiChannelPlatformLabel(client.platform),
    agentLabel: client.agentName ?? WEBUI_CHANNEL_DEFAULT_AGENT_LABEL,
    selected: client.name === selectedName,
    botName: webuiChannelBotName(client.platform, client.name),
  }));
}

/**
 * The bot's name, as the Desktop names it.
 *
 * A WeChat bot is always `ClawBot` on the Desktop; every other bot carries its binding's
 * label, and a bot with no label at all is `新 Bot`.
 */
export function webuiChannelBotName(platform: string, name: string): string {
  if (platform === "wechat") return WEBUI_CHANNEL_WECHAT_BOT_NAME;
  const trimmed = name.trim();
  return trimmed === "" ? WEBUI_CHANNEL_NEW_BOT_NAME : trimmed;
}

/**
 * The association's description for a bot that is already bound to a platform.
 *
 * The Desktop says which platform is associated, so a reader knows what 解除连接 will undo.
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
