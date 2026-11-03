// The 接入 IM list owner.
//
// Framework-free — no React, no DOM — so the transitions are testable against a scripted port
// (`packages/webui/AGENTS.md`: no jsdom in this package).
//
// Four facts it has to get right:
//
//   * **An unwired transport is not an empty list.** "This host cannot list IM bots" and "no IM
//     bot exists" are different answers, and only the second one belongs in the empty state.
//   * **A refresh keeps the rows on screen.** A read in flight shows the previous list with its
//     own status, because a panel that blanks out every few seconds is worse than one that is a
//     little stale.
//   * **Bound is the runtime's answer.** The list is the runtime's bot list, and each bot carries
//     its own state; a bot whose QR scan has not finished is listed and is *not* bound. Deriving
//     "bound" from the bot's presence in a list is how a pending scan came to read as 已绑定.
//   * **Creating a bot is two steps.** The bot is prepared, then authorized, so the card
//     that shows the QR belongs to a bot that already exists in the list under its own id.
import type {
  WebuiChannelConfigCheckResult,
  WebuiChannelConnectRequest,
  WebuiChannelConnection,
  WebuiChannelMessageFilter,
  WebuiChannelMessageFilterRequest,
} from "../../../../shared/contracts/channel.js";
import type { ChannelPort } from "../contracts/channel-port.js";
import { webuiChannelBotName } from "../projection/channel-panel.js";

export type WebuiChannelLoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * The platform the create flow is adding.
 *
 * The create menu offers one entry per platform, and the platform decides what the card
 * shows: a QR for WeChat, and — where the runtime has no onboarding route — the platform's own
 * credential form for Feishu.
 */
export type WebuiChannelAddPlatform = "wechat" | "feishu";

/**
 * The authorization one bot's card is showing.
 *
 * The QR is the authorization: the user scans it on their phone, the runtime confirms the
 * authorization, and the bot is bound.
 */
export interface WebuiChannelAuthorization {
  /** The bot the authorization belongs to. */
  readonly connectionId: string;
  readonly platform: string;
  /** Where the authorization is: being created, waiting, done, expired or refused. */
  readonly status: "starting" | "pending" | "confirmed" | "expired" | "error";
  /** The QR image the runtime produced, when it produced one. */
  readonly qrImageUrl?: string;
  /** The text the QR carries, when the runtime produced text rather than an image. */
  readonly qrContent?: string;
  /** The platform session the authorization is filed under. */
  readonly sessionId?: string;
  readonly error?: string;
}

export interface WebuiChannelSnapshot {
  readonly status: WebuiChannelLoadStatus;
  /** The bots the runtime knows, bound or waiting for their authorization. */
  readonly connections: readonly WebuiChannelConnection[];
  /** The bot whose card the pane shows. */
  readonly selectedId?: string;
  /** The authorization the selected bot's card is showing. */
  readonly authorization?: WebuiChannelAuthorization;
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
  /** Reads the bot list once. Concurrent calls share one request. */
  readonly load: () => Promise<void>;
  /** Re-reads on an interval while the pane is open. Returns the stop function. */
  readonly startRefreshing: () => () => void;
  /** Selects a bot, reads what belongs to it, and starts its authorization when it has none. */
  readonly select: (connectionId: string | undefined) => Promise<void>;
  /**
   * Creates the bot a create flow is adding, then authorizes it.
   *
   * The bot is prepared first, which is why a bot that has never been authorized appears in
   * the list: WeChat's authorization answers with a QR, and Feishu's card asks for the app id and
   * secret through this runtime's credential bind.
   */
  readonly addBot: (platform: WebuiChannelAddPlatform) => Promise<WebuiChannelMutation>;
  readonly connect: (request: WebuiChannelConnectRequest) => Promise<WebuiChannelMutation>;
  /** 解除连接: unbinds one bot and keeps it in the list. */
  readonly disconnect: (connectionId: string) => Promise<WebuiChannelMutation>;
  /** 删除Bot: removes one bot from the list. */
  readonly deleteBot: (connectionId: string) => Promise<WebuiChannelMutation>;
  readonly updateMessageFilter: (
    request: WebuiChannelMessageFilterRequest,
  ) => Promise<WebuiChannelMutation>;
  /** Reads the authorization the selected bot's card is showing. */
  readonly readAuthorization: () => Promise<WebuiChannelAuthorization | undefined>;
  /** Starts the authorization over — the 刷新二维码 action. */
  readonly refreshAuthorization: (connectionId: string) => Promise<WebuiChannelMutation>;
}

export const WEBUI_CHANNEL_UNAVAILABLE =
  "这个运行时无法管理 IM 接入（宿主没有 IM 通道服务）。";
export const WEBUI_CHANNEL_READ_FAILED = "读取 IM 接入列表失败。";
export const WEBUI_CHANNEL_FAILED = "操作 IM 接入失败。";
export const WEBUI_CHANNEL_FILTER_FAILED = "读取消息过滤设置失败。";
/** The refusal a host without the WeChat authorization route answers the create flow with. */
export const WEBUI_CHANNEL_WECHAT_UNAVAILABLE = "宿主没有微信授权通道，无法生成绑定二维码。";
/** The refusal a bot on a platform this pane has no authorization surface for answers with. */
export const WEBUI_CHANNEL_NO_AUTHORIZATION = "这个平台没有可用的授权通道。";

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
  let snapshot: WebuiChannelSnapshot = { status: "idle", connections: [] };
  let inFlight: Promise<void> | undefined;

  const publish = (next: WebuiChannelSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const failureMessage = (error: unknown): string =>
    error instanceof Error && error.message ? error.message : WEBUI_CHANNEL_FAILED;

  const load = async (): Promise<void> => {
    if (inFlight) return inFlight;
    const read = options.port.listChannelConnections;
    if (!read) {
      publish({ ...snapshot, status: "error", error: WEBUI_CHANNEL_UNAVAILABLE });
      return;
    }
    publish({ ...snapshot, status: "loading" });
    inFlight = (async () => {
      try {
        const list = await read();
        // A selection the runtime no longer reports is dropped, so the card never shows a bot
        // that was deleted elsewhere.
        const selectedId =
          snapshot.selectedId !== undefined &&
          list.connections.some((entry) => entry.connectionId === snapshot.selectedId)
            ? snapshot.selectedId
            : undefined;
        publish({
          ...snapshot,
          status: "ready",
          connections: list.connections,
          ...(selectedId === undefined
            ? { selectedId: undefined, authorization: undefined }
            : { selectedId }),
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

  /** The selected bot, as the last read left it. */
  const selectedConnection = (
    current: WebuiChannelSnapshot,
  ): WebuiChannelConnection | undefined =>
    current.selectedId === undefined
      ? undefined
      : current.connections.find((entry) => entry.connectionId === current.selectedId);

  /**
   * Reads what belongs to the selected bot.
   *
   * The configuration state is the agent's, and the message filter is the bot's own — the runtime
   * stores one filter per IM client, keyed by the transport identity of its binding.
   */
  const loadSelection = async (connectionId: string | undefined): Promise<void> => {
    const connection =
      connectionId === undefined
        ? undefined
        : snapshot.connections.find((entry) => entry.connectionId === connectionId);
    if (!connection) {
      publish({ ...snapshot, config: undefined, filter: undefined, filterError: undefined });
      return;
    }
    const checkConfig = options.port.checkChannelConfig;
    const readFilter = options.port.getChannelMessageFilter;
    let config: WebuiChannelConfigCheckResult | undefined;
    let filter: WebuiChannelMessageFilter | undefined;
    let filterError: string | undefined;
    if (checkConfig) {
      try {
        config = await checkConfig({ agent: connection.agentName });
      } catch (error) {
        config = undefined;
        filterError = failureMessage(error);
      }
    }
    const filterKey = connection.binding?.externalId;
    if (readFilter && filterKey !== undefined) {
      try {
        filter = await readFilter({ agent: filterKey });
      } catch (error) {
        filter = undefined;
        filterError = error instanceof Error && error.message ? error.message : WEBUI_CHANNEL_FILTER_FAILED;
      }
    }
    publish({ ...snapshot, config, filter, filterError });
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
   * Starts (or restarts) one bot's WeChat authorization.
   *
   * The bot already exists — it is prepared before it is authorized — so the authorization is
   * filed under that bot's own connection rather than under the agent's default client. That is
   * what makes 刷新二维码 refresh *this* bot's QR instead of issuing one for another.
   */
  const startAuthorization = async (
    connectionId: string,
  ): Promise<WebuiChannelMutation> => {
    const connection = snapshot.connections.find(
      (entry) => entry.connectionId === connectionId,
    );
    if (!connection) return { ok: false, message: WEBUI_CHANNEL_FAILED };
    // Only WeChat has an authorization route here; Feishu binds through its credential form, and
    // asking the WeChat route for it would be a request the runtime cannot answer.
    if (connection.channel !== "wechat") {
      publish({ ...snapshot, actionError: WEBUI_CHANNEL_NO_AUTHORIZATION });
      return { ok: false, message: WEBUI_CHANNEL_NO_AUTHORIZATION };
    }
    const start = options.port.startChannelWechatBind;
    if (!start) {
      // A card that cannot produce a QR says so next to the control that asked for it.
      publish({ ...snapshot, actionError: WEBUI_CHANNEL_WECHAT_UNAVAILABLE });
      return { ok: false, message: WEBUI_CHANNEL_WECHAT_UNAVAILABLE };
    }
    const base = { connectionId, platform: connection.channel } as const;
    publish({
      ...snapshot,
      selectedId: connectionId,
      authorization: { ...base, status: "starting" },
    });
    try {
      const result = await start({
        name: webuiChannelBotName(connection),
        connectionId,
      });
      if (!result.ok) {
        const message = result.error ?? WEBUI_CHANNEL_FAILED;
        publish({
          ...snapshot,
          authorization: { ...base, status: "error", error: message },
        });
        return { ok: false, message };
      }
      publish({
        ...snapshot,
        authorization: {
          ...base,
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
        authorization: { ...base, status: "error", error: message },
      });
      return { ok: false, message };
    }
  };

  const select = async (connectionId: string | undefined): Promise<void> => {
    const keepsAuthorization =
      connectionId !== undefined && snapshot.authorization?.connectionId === connectionId;
    publish({
      ...snapshot,
      selectedId: connectionId,
      config: undefined,
      filter: undefined,
      filterError: undefined,
      ...(keepsAuthorization ? {} : { authorization: undefined }),
    });
    await loadSelection(connectionId);
    if (connectionId === undefined) return;
    const connection = snapshot.connections.find(
      (entry) => entry.connectionId === connectionId,
    );
    // The pane shows an unbound WeChat bot's QR as soon as its card is on screen, and leaves a
    // bound bot alone. An authorization already in flight is not restarted.
    if (!connection || connection.state === "bound" || connection.channel !== "wechat") return;
    const current = snapshot.authorization;
    if (
      current?.connectionId === connectionId &&
      (current.status === "pending" || current.status === "starting")
    ) {
      return;
    }
    await startAuthorization(connectionId);
  };

  /**
   * Creates the bot a create flow is adding, then opens its card.
   *
   * The two steps, in order: the bot exists first, so it is in the list under its own id
   * even before anyone scans anything.
   */
  const addBot = async (
    platform: WebuiChannelAddPlatform,
  ): Promise<WebuiChannelMutation> => {
    const prepare = options.port.prepareChannelConnection;
    if (!prepare) {
      publish({ ...snapshot, actionError: WEBUI_CHANNEL_UNAVAILABLE });
      return { ok: false, message: WEBUI_CHANNEL_UNAVAILABLE };
    }
    const known = new Set(snapshot.connections.map((entry) => entry.connectionId));
    try {
      const answer = await prepare({ platform });
      if (answer.success === false) {
        const message = answer.error ?? WEBUI_CHANNEL_FAILED;
        publish({ ...snapshot, actionError: message });
        return { ok: false, message };
      }
      publish({ ...snapshot, actionError: undefined });
      await load();
      const created =
        snapshot.connections.find(
          (entry) => !known.has(entry.connectionId) && entry.channel === platform,
        ) ?? [...snapshot.connections].reverse().find((entry) => entry.channel === platform);
      if (!created) return { ok: true };
      await select(created.connectionId);
      return { ok: true };
    } catch (error) {
      const message = failureMessage(error);
      publish({ ...snapshot, actionError: message });
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
    // The runtime files the authorization under a session, and under the bot's connection, so
    // either one names it.
    if (!current || current.status !== "pending" || !read) {
      return current;
    }
    try {
      const result = await read({
        connectionId: current.connectionId,
        ...(current.sessionId === undefined ? {} : { sessionId: current.sessionId }),
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
        ...(result.error === undefined ? {} : { error: result.error }),
      };
      publish({ ...snapshot, authorization: next });
      if (status === "confirmed") {
        await load();
        publish({ ...snapshot, authorization: undefined });
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
    addBot,
    connect: (request) =>
      mutate(
        options.port.connectChannel
          ? () => options.port.connectChannel!(request)
          : undefined,
        WEBUI_CHANNEL_FAILED,
      ),
    disconnect: (connectionId) =>
      mutate(
        options.port.disconnectChannelConnection
          ? () => options.port.disconnectChannelConnection!({ connectionId })
          : undefined,
        WEBUI_CHANNEL_FAILED,
      ),
    deleteBot: async (connectionId) => {
      const result = await mutate(
        options.port.deleteChannelConnection
          ? () => options.port.deleteChannelConnection!({ connectionId })
          : undefined,
        WEBUI_CHANNEL_FAILED,
      );
      // The card cannot outlive the bot it describes.
      if (result.ok && snapshot.selectedId === connectionId) {
        publish({ ...snapshot, selectedId: undefined, authorization: undefined });
      }
      return result;
    },
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
    readAuthorization,
    refreshAuthorization: (connectionId) => startAuthorization(connectionId),
  };
}
