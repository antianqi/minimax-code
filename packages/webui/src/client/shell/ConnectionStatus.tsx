import { useEffect, useRef, type ReactElement } from "react";
import { useWebuiSessionStream } from "../bindings/use-session-state.js";
import type { WebuiStreamState } from "../features/turn/projection/stream-state.js";
import { FeedbackLiveRegion } from "../ui/feedback.js";
import { useWebuiToast } from "../ui/toast.js";

/**
 * The connection states a user can act on.
 *
 * `projectWebuiConnectionState` projects the turn stream's own phase, which the
 * reconnect paths in `stream.ts` and `SessionComposer.tsx` drive. That
 * projection still names `reconnecting`, because the loop really is in that
 * phase; this component simply does not announce it.
 *
 * Reconnect attempts are deliberately silent. A recovering link is normal
 * traffic — the loop retries on its own within a few hundred milliseconds, and
 * a notice for it appears on every page load, every tab wake and every short
 * gap, then vanishes before the reader has decided whether to act. The idle
 * watcher's degraded signal is silent for the same reason. Nothing is announced
 * until the loop gives up, at which point 「连接失败」 is true and the retry
 * affordance is worth its space.
 *
 * A gap this leaves: a fatally degraded event channel retries nothing on its
 * own either, and its only exits are an explicit `health.reconnect()` (no UI
 * consumer yet) or a fresh subscription.
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

/** The copy for the two states that render; `reconnecting` has none by design. */
const COPY: Readonly<
  Record<Exclude<WebuiConnectionState, "reconnecting">, { readonly label: string; readonly detail: string }>
> = {
  connected: {
    label: "已连接",
    detail: "实时连接正常",
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
  // Only a terminal failure is announced. A reconnect attempt is the loop
  // doing its job, so it stays silent — and it must not read as 已连接 either,
  // which is why the phase is projected whole and each surface picks its state.
  const connection = projectWebuiConnectionState(stream.phase);
  const { show, dismiss } = useWebuiToast();
  const toastIdRef = useRef<string>();
  const lastNoticeKeyRef = useRef<string>();
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;
  const reason = stream.refusal ?? stream.status;
  const detail = reason ?? COPY.failed.detail;
  const noticeKey = `${sessionId ?? "home"}:${connection}:${detail}:${retryLabel}:${Boolean(onRetry)}`;
  useEffect(() => {
    if (connection !== "failed") {
      if (toastIdRef.current) dismiss(toastIdRef.current);
      toastIdRef.current = undefined;
      lastNoticeKeyRef.current = undefined;
      return;
    }
    if (lastNoticeKeyRef.current === noticeKey) return;
    if (toastIdRef.current) dismiss(toastIdRef.current);
    lastNoticeKeyRef.current = noticeKey;
    toastIdRef.current = show({
      tone: "error",
      message: COPY.failed.label,
      description: detail,
      ...(retryRef.current
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
