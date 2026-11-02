// The 接入 IM list owner.
//
// Framework-free — no React, no DOM — so the transitions are testable against a scripted port
// (`packages/webui/AGENTS.md`: no jsdom in this package).
//
// Three facts it has to get right:
//
//   * **An unwired transport is not an empty list.** "This host cannot list IM clients" and "no
//     IM client is bound" are different answers, and only the second one belongs in the empty
//     state.
//   * **A refresh keeps the rows on screen.** A read in flight shows the previous list with its
//     own status, because a panel that blanks out every few seconds is worse than one that is a
//     little stale.
//   * **The message filter is keyed by the IM client's own name.** The runtime stores one filter
//     per client (`mavis` for Feishu, `wechat:mavis` for WeChat), so the selected client's name is
//     what travels in the request the wire names `agent`.
import type {
  WebuiChannelClient,
  WebuiChannelConfigCheckResult,
  WebuiChannelConnectRequest,
  WebuiChannelDisconnectRequest,
  WebuiChannelMessageFilter,
  WebuiChannelMessageFilterRequest,
} from "../../../../shared/contracts/channel.js";
import type { ChannelPort } from "../contracts/channel-port.js";
import { WEBUI_CHANNEL_WECHAT_BOT_NAME } from "../projection/channel-panel.js";

export type WebuiChannelLoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * The platform the create flow is adding.
 *
 * Desktop's create menu offers one entry per platform, and the platform decides what the card
 * shows: a QR for WeChat, and — where the runtime has no onboarding route — the platform's own
 * credential form for Feishu.
 */
export type WebuiChannelAddPlatform = "wechat" | "feishu";

/**
 * The authorization the create flow is running.
 *
 * The QR is the authorization: the user scans it on their phone, the runtime confirms the
 * authorization, and the bot is bound. `userCode` is the code the user types when the QR does
 * not carry it.
 */
export interface WebuiChannelAuthorization {
  readonly platform: WebuiChannelAddPlatform;
  /** Where the authorization is: being created, waiting, done, expired or refused. */
  readonly status: "starting" | "pending" | "confirmed" | "expired" | "error";
  /** The QR image the runtime produced, when it produced one. */
  readonly qrImageUrl?: string;
  /** The text the QR carries, when the runtime produced text rather than an image. */
  readonly qrContent?: string;
  readonly connectionId?: string;
  readonly sessionId?: string;
  readonly error?: string;
}

export interface WebuiChannelSnapshot {
  readonly status: WebuiChannelLoadStatus;
  /** The platform the create flow is adding, when the create flow is open. */
  readonly addPlatform?: WebuiChannelAddPlatform;
  /** The authorization the create flow is running. */
  readonly authorization?: WebuiChannelAuthorization;
  /** The bound IM clients, in the runtime's own order. */
  readonly clients: readonly WebuiChannelClient[];
  /** The client whose detail the pane shows. */
  readonly selectedName?: string;
  /** Present when the last read failed; the rows are then the last good ones. */
  readonly error?: string;
  /** Present when the last mutation failed. */
  readonly actionError?: string;
  /** Whether the selected client's agent has an IM channel configured on this host. */
  readonly config?: WebuiChannelConfigCheckResult;
  /** The selected client's message filter. */
  readonly filter?: WebuiChannelMessageFilter;
  /** Present when the message filter could not be read. */
  readonly filterError?: string;
  readonly loadedAtMs?: number;
}

/**
 * What a mutation answered.
 *
 * A failure is a value, not a thrown error, because the pane's job is to put the reason next to
 * the button that caused it: the runtime's own refusal belongs there, not in a generic error
 * boundary that cannot name it.
 */
export type WebuiChannelMutation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

export interface WebuiChannelOwner {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WebuiChannelSnapshot;
  /** Reads the bound clients once. Concurrent calls share one request. */
  readonly load: () => Promise<void>;
  /** Re-reads on an interval while the pane is open. Returns the stop function. */
  readonly startRefreshing: () => () => void;
  /** Selects a client and reads what belongs to it. */
  readonly select: (name: string | undefined) => Promise<void>;
  readonly connect: (request: WebuiChannelConnectRequest) => Promise<WebuiChannelMutation>;
  readonly disconnect: (request: WebuiChannelDisconnectRequest) => Promise<WebuiChannelMutation>;
  readonly updateMessageFilter: (
    request: WebuiChannelMessageFilterRequest,
  ) => Promise<WebuiChannelMutation>;
  /**
   * Opens the create flow for one platform.
   *
   * WeChat starts an authorization and answers with its QR; Feishu opens the platform's own
   * credential form, which the runtime's connect route serves.
   */
  readonly startAdding: (platform: WebuiChannelAddPlatform) => Promise<WebuiChannelMutation>;
  /** Reads the authorization the create flow is running. */
  readonly readAuthorization: () => Promise<WebuiChannelAuthorization | undefined>;
  /** Starts the authorization over — the Desktop's 刷新二维码. */
  readonly renewAuthorization: () => Promise<WebuiChannelMutation>;
  /** Leaves the create flow. */
  readonly cancelAdding: () => void;
}

export const WEBUI_CHANNEL_UNAVAILABLE =
  "这个运行时无法管理 IM 接入（宿主没有 IM 通道服务）。";
export const WEBUI_CHANNEL_READ_FAILED = "读取 IM 接入列表失败。";
export const WEBUI_CHANNEL_FAILED = "操作 IM 接入失败。";
export const WEBUI_CHANNEL_FILTER_FAILED = "读取消息过滤设置失败。";
/** The refusal a host without the WeChat authorization route answers the create flow with. */
export const WEBUI_CHANNEL_WECHAT_UNAVAILABLE = "宿主没有微信授权通道，无法生成绑定二维码。";

export interface CreateWebuiChannelOwnerOptions {
  readonly port: ChannelPort;
  readonly nowMs?: () => number;
  /** How often the open pane re-reads. Five seconds: a bot bound elsewhere shows up. */
  readonly refreshMs?: number;
  readonly setIntervalFn?: (callback: () => void, ms: number) => unknown;
  readonly clearIntervalFn?: (handle: unknown) => void;
}

const DEFAULT_REFRESH_MS = 5_000;

export function createWebuiChannelOwner(
  options: CreateWebuiChannelOwnerOptions,
): WebuiChannelOwner {
  const nowMs = options.nowMs ?? Date.now;
  const refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
  const setIntervalFn =
    options.setIntervalFn ?? ((callback, ms) => setInterval(callback, ms) as unknown);
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle as never));

  const listeners = new Set<() => void>();
  let snapshot: WebuiChannelSnapshot = { status: "idle", clients: [] };
  let inFlight: Promise<void> | undefined;

  const publish = (next: WebuiChannelSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const failureMessage = (error: unknown): string =>
    error instanceof Error && error.message ? error.message : WEBUI_CHANNEL_FAILED;

  const load = async (): Promise<void> => {
    if (inFlight) return inFlight;
    const read = options.port.listChannelStatus;
    if (!read) {
      publish({ ...snapshot, status: "error", error: WEBUI_CHANNEL_UNAVAILABLE });
      return;
    }
    publish({ ...snapshot, status: "loading" });
    inFlight = (async () => {
      try {
        const status = await read();
        publish({
          ...snapshot,
          status: "ready",
          clients: status.clients,
          loadedAtMs: nowMs(),
        });
      } catch (error) {
        publish({
          ...snapshot,
          status: "error",
          error: error instanceof Error && error.message ? error.message : WEBUI_CHANNEL_READ_FAILED,
        });
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  /** The selected client, as the last read left it. */
  const selectedClient = (
    current: WebuiChannelSnapshot,
  ): WebuiChannelClient | undefined =>
    current.selectedName === undefined
      ? undefined
      : current.clients.find((client) => client.name === current.selectedName);

  /**
   * Reads what belongs to the selected client.
   *
   * The configuration state is the agent's, and the message filter is the client's own — the
   * runtime stores one filter per IM client, not per agent.
   */
  const loadSelection = async (name: string | undefined): Promise<void> => {
    const client = name === undefined ? undefined : snapshot.clients.find((c) => c.name === name);
    if (!client) {
      publish({ ...snapshot, config: undefined, filter: undefined, filterError: undefined });
      return;
    }
    const checkConfig = options.port.checkChannelConfig;
    const readFilter = options.port.getChannelMessageFilter;
    let config: WebuiChannelConfigCheckResult | undefined;
    let filter: WebuiChannelMessageFilter | undefined;
    let filterError: string | undefined;
    if (checkConfig && client.agentName !== undefined) {
      try {
        config = await checkConfig({ agent: client.agentName });
      } catch (error) {
        config = undefined;
        filterError = failureMessage(error);
      }
    }
    if (readFilter) {
      try {
        filter = await readFilter({ agent: client.name });
      } catch (error) {
        filter = undefined;
        filterError = error instanceof Error && error.message ? error.message : WEBUI_CHANNEL_FILTER_FAILED;
      }
    }
    publish({ ...snapshot, config, filter, filterError });
  };

  const select = async (name: string | undefined): Promise<void> => {
    publish({ ...snapshot, selectedName: name, config: undefined, filter: undefined, filterError: undefined });
    await loadSelection(name);
  };

  /** Runs one mutation, then re-reads the list so the pane shows what the runtime stored. */
  const mutate = async (
    run: (() => Promise<{ readonly success?: boolean; readonly error?: string }>) | undefined,
    refusal: string,
  ): Promise<WebuiChannelMutation> => {
    if (!run) return { ok: false, message: WEBUI_CHANNEL_UNAVAILABLE };
    try {
      const answer = await run();
      if (answer.success === false) {
        const message = answer.error ?? refusal;
        publish({ ...snapshot, actionError: message });
        return { ok: false, message };
      }
      publish({ ...snapshot, actionError: undefined });
      await load();
      return { ok: true };
    } catch (error) {
      const message = failureMessage(error);
      publish({ ...snapshot, actionError: message });
      return { ok: false, message };
    }
  };

  /**
   * Opens the create flow.
   *
   * WeChat's authorization is the runtime's own route: it answers with the QR to show and with the
   * connection to poll. Feishu has no onboarding route on this runtime, so its flow is the
   * platform's credential form, which the connect route serves.
   */
  const startAdding = async (platform: WebuiChannelAddPlatform): Promise<WebuiChannelMutation> => {
    if (platform === "feishu") {
      publish({ ...snapshot, addPlatform: platform, authorization: undefined });
      return { ok: true };
    }
    const start = options.port.startChannelWechatBind;
    if (!start) {
      // A create flow that cannot produce a QR says so next to the entry that started it.
      publish({ ...snapshot, actionError: WEBUI_CHANNEL_WECHAT_UNAVAILABLE });
      return { ok: false, message: WEBUI_CHANNEL_WECHAT_UNAVAILABLE };
    }
    publish({
      ...snapshot,
      addPlatform: platform,
      authorization: { platform, status: "starting" },
    });
    try {
      const result = await start({ name: WEBUI_CHANNEL_WECHAT_BOT_NAME });
      if (!result.ok) {
        const message = result.error ?? WEBUI_CHANNEL_FAILED;
        publish({
          ...snapshot,
          addPlatform: platform,
          authorization: { platform, status: "error", error: message },
        });
        return { ok: false, message };
      }
      publish({
        ...snapshot,
        addPlatform: platform,
        authorization: {
          platform,
          status: "pending",
          ...(result.qrImageUrl === undefined ? {} : { qrImageUrl: result.qrImageUrl }),
          ...(result.qrContent === undefined ? {} : { qrContent: result.qrContent }),
          ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }),
        },
      });
      return { ok: true };
    } catch (error) {
      const message = failureMessage(error);
      publish({
        ...snapshot,
        addPlatform: platform,
        authorization: { platform, status: "error", error: message },
      });
      return { ok: false, message };
    }
  };

  /**
   * Reads the authorization the create flow is running.
   *
   * A confirmed authorization binds the bot, so the list is read again and the create flow closes:
   * the bot then appears in the list, where it belongs.
   */
  const readAuthorization = async (): Promise<WebuiChannelAuthorization | undefined> => {
    const current = snapshot.authorization;
    const read = options.port.getChannelWechatBindStatus;
    // The runtime files the authorization under a session, and under a connection once the scan
    // has confirmed it, so either one names it.
    if (
      !current ||
      current.status !== "pending" ||
      (current.sessionId === undefined && current.connectionId === undefined) ||
      !read
    ) {
      return current;
    }
    try {
      const result = await read({
        ...(current.sessionId === undefined ? {} : { sessionId: current.sessionId }),
        ...(current.connectionId === undefined ? {} : { connectionId: current.connectionId }),
      });
      const status =
        result.status === "confirmed"
          ? "confirmed"
          : result.status === "expired"
            ? "expired"
            : result.status === "error"
              ? "error"
              : "pending";
      const next: WebuiChannelAuthorization = {
        ...current,
        status,
        ...(result.connectionId === undefined ? {} : { connectionId: result.connectionId }),
        ...(result.error === undefined ? {} : { error: result.error }),
      };
      publish({ ...snapshot, authorization: next });
      if (status === "confirmed") {
        await load();
        publish({ ...snapshot, addPlatform: undefined, authorization: undefined });
        return undefined;
      }
      return next;
    } catch (error) {
      const next: WebuiChannelAuthorization = {
        ...current,
        status: "error",
        error: failureMessage(error),
      };
      publish({ ...snapshot, authorization: next });
      return next;
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    load,
    startRefreshing: () => {
      const handle = setIntervalFn(() => void load(), refreshMs);
      return () => clearIntervalFn(handle);
    },
    select,
    connect: (request) =>
      mutate(
        options.port.connectChannel
          ? () => options.port.connectChannel!(request)
          : undefined,
        WEBUI_CHANNEL_FAILED,
      ),
    disconnect: (request) =>
      mutate(
        options.port.disconnectChannel
          ? () => options.port.disconnectChannel!(request)
          : undefined,
        WEBUI_CHANNEL_FAILED,
      ),
    updateMessageFilter: async (request) => {
      const write = options.port.updateChannelMessageFilter;
      if (!write) return { ok: false, message: WEBUI_CHANNEL_UNAVAILABLE };
      try {
        const filter = await write(request);
        publish({ ...snapshot, filter, filterError: undefined, actionError: undefined });
        return { ok: true };
      } catch (error) {
        const message = failureMessage(error);
        publish({ ...snapshot, actionError: message });
        return { ok: false, message };
      }
    },
    startAdding,
    readAuthorization,
    renewAuthorization: () => startAdding("wechat"),
    cancelAdding: () => {
      publish({ ...snapshot, addPlatform: undefined, authorization: undefined });
    },
  };
}
