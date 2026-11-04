import { useEffect, useRef, type ReactElement } from "react";
import { useWebuiSessionStream } from "../bindings/use-session-state.js";
import { useWebuiEventChannelDegraded } from "../bindings/use-connection-health.js";
import type { WebuiStreamState } from "../features/turn/projection/stream-state.js";
import { FeedbackLiveRegion } from "../ui/feedback.js";
import { useWebuiToast } from "../ui/toast.js";

/**
 * The three states a user can act on.
 *
 * Two signals feed this, and they are deliberately kept apart:
 *
 * - `projectWebuiConnectionState` still projects **only** the turn stream's own
 *   phase, which the reconnect paths in `stream.ts` and `SessionComposer.tsx`
 *   drive. It says nothing about a link that is not carrying a turn.
 * - `useWebuiEventChannelDegraded` is the **transport-level** signal, and it
 *   exists because the projection above cannot answer that question. The
 *   long-lived `watchEvents` socket marks itself healthy on an ack and degraded
 *   on `close`, and the component merges the two: failed beats reconnecting
 *   beats connected.
 *
 * What the channel signal covers, and what it still does not. The watcher
 * socket sends a periodic liveness probe, so a silently dead (half-open) link
 * — one that would never deliver a close event — is forced to reconnect once
 * the probe timeout runs out, and reads as reconnecting while it does. A
 * watcher that was never accepted is degraded by the 30 s startup grace
 * instead of staying unknown forever, and immediately when the channel goes
 * fatal. The remaining gap is deliberate: a fatal channel still borrows the
 * reconnecting copy — 「正在自动恢复」 is not literally true there, since fatal
 * never retries on its own — and offers no retry button, because that state's
 * only exits are an explicit `health.reconnect()` (no UI consumer yet) or a
 * fresh subscription; wiring either into this component would change the
 * merge semantics below, so it is left out rather than half-added.
 */
export type WebuiConnectionState = "connected" | "reconnecting" | "failed";

/**
 * Projects the stream phase onto the connection state a user cares about.
 *
 * `reconnecting` is its own phase, so it maps straight across. `error` and
 * `refused` are the two terminal-failure phases the loop commits when it gives
 * up. Every other phase — `idle`, `streaming`, `waiting`, `done` — means the
 * client holds a working subscription, which is what "connected" means to
 * someone reading a status line.
 */
export function projectWebuiConnectionState(
  phase: WebuiStreamState["phase"],
): WebuiConnectionState {
  if (phase === "reconnecting") return "reconnecting";
  if (phase === "error" || phase === "refused") return "failed";
  return "connected";
}

const COPY: Readonly<
  Record<WebuiConnectionState, { readonly label: string; readonly detail: string }>
> = {
  connected: {
    label: "已连接",
    detail: "实时连接正常",
  },
  reconnecting: {
    label: "正在重连",
    detail: "连接中断，正在自动恢复",
  },
  failed: {
    label: "连接失败",
    detail: "已停止接收更新",
  },
};

export interface ConnectionStatusProps {
  /** Omitted on the home screen, which the store keys as its home runtime. */
  readonly sessionId?: string;
  readonly className?: string;
  /**
   * The host's layout call on whether a healthy connection earns a standing
   * line. The shell passes true: 已连接 is the state worth zero pixels, and
   * the region earns its place only when something needs the reader's
   * attention. Omitted, all three states render — the component itself stays
   * state-complete for any host that wants a permanent indicator.
   */
  readonly hideWhenConnected?: boolean;
  /**
   * Offers a manual retry from the failed state. The shell wires this to a
   * fresh stream-loop run anchored on the last cursor this client applied.
   * Omitted, no button renders — a host with no recovery path should not
   * offer one.
   */
  readonly onRetry?: () => void;
  /** The retry affordance's label, overridable the way the boundary's is. */
  readonly retryLabel?: string;
}

/**
 * Surfaces the user's connection state. Subscribes through
 * `useSessionRuntimeState` — the same hook the composer and shell already read —
 * rather than opening a second channel, so there is exactly one listener set
 * per session and no new reconnect state to keep in sync.
 *
 * Connection interruptions and failures are announced through the shared
 * toast, so they never take space from the transcript. A failure keeps its
 * manual retry action in that toast; whether the healthy connection should be
 * visible is the host's layout call, not this component's.
 */
export function ConnectionStatus({
  sessionId,
  className,
  hideWhenConnected,
  onRetry,
  retryLabel = "重试连接",
}: ConnectionStatusProps): ReactElement | null {
  const stream = useWebuiSessionStream(sessionId);
  // Two independent signals, merged: the selected session's stream phase (a
  // turn that failed mid-flight) and the event channel's health (the
  // always-on watcher, which is the only live link while the page is idle).
  // Either one saying "trouble" shows the region; a terminal stream failure
  // outranks a degraded-but-retrying channel.
  const streamConnection = projectWebuiConnectionState(stream.phase);
  const channelDegraded = useWebuiEventChannelDegraded();
  const connection =
    streamConnection === "failed"
      ? "failed"
      : streamConnection === "reconnecting" || channelDegraded
        ? "reconnecting"
        : "connected";
  const { show, dismiss } = useWebuiToast();
  const toastIdRef = useRef<string>();
  const lastNoticeKeyRef = useRef<string>();
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  const reason = stream.refusal ?? stream.status;
  const detail = connection === "failed"
    ? reason ?? COPY.failed.detail
    : COPY.reconnecting.detail;
  const noticeKey = `${sessionId ?? "home"}:${connection}:${detail}:${retryLabel}:${Boolean(onRetry)}`;
  useEffect(() => {
    if (connection === "connected") {
      if (toastIdRef.current) dismiss(toastIdRef.current);
      toastIdRef.current = undefined;
      lastNoticeKeyRef.current = undefined;
      return;
    }
    if (lastNoticeKeyRef.current === noticeKey) return;
    if (toastIdRef.current) dismiss(toastIdRef.current);
    lastNoticeKeyRef.current = noticeKey;
    toastIdRef.current = show({
      tone: connection === "failed" ? "error" : "warning",
      message: COPY[connection].label,
      description: detail,
      ...(connection === "failed" && retryRef.current
        ? {
            action: {
              label: retryLabel,
              onClick: () => retryRef.current?.(),
            },
            durationMs: 0,
          }
        : {}),
      testId: "webui-connection-status-toast",
      dataAttributes: { "data-connection-state": connection },
    });
  }, [connection, detail, dismiss, noticeKey, retryLabel, show]);
  if (hideWhenConnected && connection === "connected") return null;
  if (connection !== "connected") return null;
  const copy = COPY[connection];
  return (
    <FeedbackLiveRegion
      testId="webui-connection-status"
      dataAttributes={{ "data-connection-state": connection }}
      className={`flex items-center gap-spacing_8 text-size_12 text-text_default_secondary${className ? ` ${className}` : ""}`}
    >
      <span data-testid="webui-connection-status-label">{copy.label}</span>
      <span data-testid="webui-connection-status-detail">{copy.detail}</span>
    </FeedbackLiveRegion>
  );
}
