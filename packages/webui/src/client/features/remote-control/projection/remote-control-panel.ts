// The 远程控制 projection.
//
// A pure function of the owner's snapshot and the clock: the copy this page shows, in the
// order this page shows it, plus the live state (the pairing code and its countdown, the linked
// device, the pending unbind).
//
// The copy is kept here rather than in the component so a test can assert the page's wording
// without rendering it.
//
// ## The countdown
//
// The pairing code is good for a while and then it is not. The model therefore carries the
// seconds that are left, computed from the moment the code stops being valid, and the panel drops
// the code entirely once that moment has passed. A code shown as if it were live would send the
// user to the MiniMax App with a number the server no longer accepts.
import type {
  WebuiRemoteControlPendingUnbind,
  WebuiRemoteControlPhase,
  WebuiRemoteControlStatus,
} from "../../../../shared/contracts/remote-control.js";

export type WebuiRemoteControlOwnerStatus =
  /** Nothing read yet. */
  | "idle"
  /** A read is in flight. */
  | "loading"
  /** The link's state is known. */
  | "ready"
  /** This host cannot host a phone link. */
  | "unavailable"
  /** The last read failed. */
  | "error";

export interface WebuiRemoteControlSnapshot {
  readonly status: WebuiRemoteControlOwnerStatus;
  /** The bridge's own snapshot, when one was read. */
  readonly link?: WebuiRemoteControlStatus;
  /** The moment the pairing code stops being valid, when one is showing. */
  readonly pairingExpiresAtMs?: number;
  /** The producer-wide unbind waiting for the user's confirmation. */
  readonly pendingUnbind?: WebuiRemoteControlPendingUnbind;
  /** The failure that kept the page from reading the link. */
  readonly error?: string;
  readonly loadedAtMs?: number;
}

/** The hero title. */
export const WEBUI_REMOTE_CONTROL_TITLE = "用手机连接你的 MiniMax Code";
/** The line under the title. */
export const WEBUI_REMOTE_CONTROL_SUBTITLE = "通过 MiniMax App 访问此电脑，随时随地继续桌面端的任务";
/** The three feature rows, in the order this panel shows them. */
export const WEBUI_REMOTE_CONTROL_FEATURES: readonly {
  readonly key: "takeover" | "continuous" | "anywhere";
  readonly text: string;
}[] = [
  { key: "takeover", text: "手机直接接管电脑上复杂任务，无需守在屏幕前。" },
  { key: "continuous", text: "对话不断线，进度、指令和审批，手机端随时处理。" },
  { key: "anywhere", text: "遛狗、散步、晒太阳，都可以是你的工作场景。" },
];
/** The button that starts the pairing flow. */
export const WEBUI_REMOTE_CONTROL_CONNECT_LABEL = "连接";
/** The button's label while a pairing code is being asked for. */
export const WEBUI_REMOTE_CONTROL_CONNECTING_LABEL = "连接中…";
/**
 * The entry under the card's action.
 *
 * The page links to its connection settings, not to SSH: the entry is
 * `remote_control.settings_link` and it opens the settings app's 连接 tab, which carries the
 * remote-control device list and the SSH hosts together.
 */
export const WEBUI_REMOTE_CONTROL_SETTINGS_LABEL = "设置";
/** The settings entry's accessible name. */
export const WEBUI_REMOTE_CONTROL_SETTINGS_ARIA_LABEL = "打开连接设置";
/** The bound state's title: the phone is on the line. */
export const WEBUI_REMOTE_CONTROL_CONNECTED_TITLE = "已连接";
/** The bound state's title: the link exists but the phone is not on it. */
export const WEBUI_REMOTE_CONTROL_DISCONNECTED_TITLE = "未连接";
/** The bound state's title: the link exists and the phone's presence is not known. */
export const WEBUI_REMOTE_CONTROL_BOUND_TITLE = "已绑定";
/**
 * The title for a host that cannot host a phone link.
 *
 * The wording for this state names an app version that is too old, which is
 * not this host's reason: the WebUI's runtime either owns the remote-control bridge or it does
 * not. The state keeps that shape (one title, no card) and this host's reason.
 */
export const WEBUI_REMOTE_CONTROL_UNAVAILABLE_TITLE =
  "这个运行时无法托管手机远程控制（宿主没有远程控制能力）。";
/** The two app-store marks under the card. */
export const WEBUI_REMOTE_CONTROL_PLATFORM_MARKS: readonly {
  readonly key: "android" | "ios";
  readonly label: string;
  /**
   * Whether the host publishes a download QR code for this platform.
   *
   * The electron app reads it from its native download config and shows the mark as a link
   * that opens the QR code on hover. This host publishes no such config, so the mark carries the
   * disabled treatment rather than pretending a code is one hover away.
   */
  readonly enabled: boolean;
}[] = [
  { key: "android", label: "安卓", enabled: false },
  { key: "ios", label: "iOS", enabled: false },
];
/** The minimum app version, said twice: as the group's name and as the line. */
export const WEBUI_REMOTE_CONTROL_MINIMUM_VERSION = "支持移动端 App 4.15.0 及以上版本";

/**
 * Which page this panel shows.
 *
 * `unavailable` — this host cannot host a phone link at all, so the lone title
 * appears with no card. `unbound` — no phone is linked: the hero title and the 连接 button.
 * `bound` — a phone is linked: the state title and the settings entry alone.
 */
export type WebuiRemoteControlPageState = "unavailable" | "unbound" | "bound";

export interface WebuiRemoteControlPanelModel {
  readonly state: WebuiRemoteControlPageState;
  /** The hero title. It is the state's title, not a fixed headline. */
  readonly title: string;
  readonly subtitle: string;
  readonly features: readonly { readonly key: string; readonly text: string }[];
  readonly connectLabel: string;
  readonly connectingLabel: string;
  readonly settingsLabel: string;
  readonly settingsAriaLabel: string;
  readonly platformMarks: readonly {
    readonly key: string;
    readonly label: string;
    readonly enabled: boolean;
  }[];
  readonly minimumVersion: string;
  /** The bridge's phase, as the browser knows it. */
  readonly phase: WebuiRemoteControlPhase;
  /** The pairing code, while it is still valid. */
  readonly pairingCode?: string;
  /** The seconds the code is still good for. */
  readonly pairingExpiresInSeconds?: number;
  /** True once the code's moment has passed; the code is then not shown at all. */
  readonly pairingExpired: boolean;
  /** The failure the page shows above the card. */
  readonly error?: string;
  /** Whether the 连接 button is live. */
  readonly canConnect: boolean;
  /** Whether the card carries the 连接 button. */
  readonly showsConnectButton: boolean;
  /** Whether the card carries the settings entry. */
  readonly showsSettingsLink: boolean;
}

/**
 * The page's model.
 *
 * `nowMs` is a parameter, not a call to the clock: the countdown is the one thing on this page
 * that changes without the host saying anything, so a test has to be able to place it.
 */
export function webuiRemoteControlPanelModel(
  snapshot: WebuiRemoteControlSnapshot,
  nowMs: number,
): WebuiRemoteControlPanelModel {
  const link = snapshot.link;
  const phase = link?.phase ?? "idle";
  const expiresAtMs = snapshot.pairingExpiresAtMs;
  const pairingExpired =
    expiresAtMs !== undefined && nowMs >= expiresAtMs;
  const pairingExpiresInSeconds =
    expiresAtMs === undefined
      ? undefined
      : Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1_000));
  // A code whose moment has passed is not shown: the user would type a number the server has
  // already forgotten.
  const pairingCode =
    phase === "pairing" && !pairingExpired && link?.pairingCode ? link.pairingCode : undefined;

  // The panel shows one of three titles once a phone is linked: 已连接 when the phone is on
  // the line, 未连接 when it is not, and 已绑定 when its presence is not known. Its
  // mobileOnline flag carries that fact; the bridge's phase carries the same one.
  const state: WebuiRemoteControlPageState =
    snapshot.status === "unavailable"
      ? "unavailable"
      : phase === "connected" || phase === "connecting" || phase === "reconnecting"
        ? "bound"
        : "unbound";
  const title =
    state === "unavailable"
      ? WEBUI_REMOTE_CONTROL_UNAVAILABLE_TITLE
      : state === "bound"
        ? phase === "connected"
          ? WEBUI_REMOTE_CONTROL_CONNECTED_TITLE
          : phase === "reconnecting"
            ? WEBUI_REMOTE_CONTROL_DISCONNECTED_TITLE
            : WEBUI_REMOTE_CONTROL_BOUND_TITLE
        : WEBUI_REMOTE_CONTROL_TITLE;

  return {
    state,
    title,
    subtitle: WEBUI_REMOTE_CONTROL_SUBTITLE,
    features: WEBUI_REMOTE_CONTROL_FEATURES,
    connectLabel: WEBUI_REMOTE_CONTROL_CONNECT_LABEL,
    connectingLabel: WEBUI_REMOTE_CONTROL_CONNECTING_LABEL,
    settingsLabel: WEBUI_REMOTE_CONTROL_SETTINGS_LABEL,
    settingsAriaLabel: WEBUI_REMOTE_CONTROL_SETTINGS_ARIA_LABEL,
    platformMarks: WEBUI_REMOTE_CONTROL_PLATFORM_MARKS,
    minimumVersion: WEBUI_REMOTE_CONTROL_MINIMUM_VERSION,
    phase,
    ...(pairingCode === undefined ? {} : { pairingCode }),
    ...(pairingExpiresInSeconds === undefined ? {} : { pairingExpiresInSeconds }),
    pairingExpired,
    ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
    canConnect: snapshot.status === "ready" || snapshot.status === "idle",
    showsConnectButton: state === "unbound",
    showsSettingsLink: state === "unbound" || state === "bound",
  };
}
