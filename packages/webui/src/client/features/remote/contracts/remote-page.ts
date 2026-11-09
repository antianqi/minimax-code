// The 远程 page's tab model.
//
// Two tabs: 远程控制 and 接入 IM.

/** The 远程 page's two tabs. */
export type WebuiRemoteTabValue = "remote-control" | "im-connect";

export interface WebuiRemoteTab {
  readonly value: WebuiRemoteTabValue;
  readonly label: string;
}

/**
 * The tab strip, in the order this page shows it.
 *
 * The tab strip labels are shown in this order.
 */
export const WEBUI_REMOTE_TABS: readonly WebuiRemoteTab[] = [
  { value: "remote-control", label: "远程控制" },
  { value: "im-connect", label: "接入 IM" },
];

/** The tab the page opens on: the pairing page. */
export const WEBUI_REMOTE_DEFAULT_TAB: WebuiRemoteTabValue = "remote-control";
