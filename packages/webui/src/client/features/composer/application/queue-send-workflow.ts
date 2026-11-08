import type { WebuiSessionStore } from "../../../application/session-store.js";
import type { WebuiQueueSend } from "../../transcript/contracts/message-view.js";
import type { WebuiQueueItem } from "../../../../shared/contracts/queue.js";
import { isWebuiWireError } from "../../../../shared/envelope.js";

/** Queue admission and canonical message appearance are separate acknowledgements. */
export function createWebuiQueueSendWorkflow(deps: {
  readonly store: WebuiSessionStore;
  readonly readQueued: (sessionId: string, itemId: string) => WebuiQueueItem | undefined;
  readonly submit: (input: { readonly sessionId: string; readonly itemId: string }) => Promise<void>;
  readonly refreshHistory: (sessionId: string) => Promise<unknown>;
}) {
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const replace = (sessionId: string, before: WebuiQueueSend | undefined, next: WebuiQueueSend): void => {
    if (disposed) return;
    deps.store.updateSession(sessionId, (current) => {
      const sends = current.transcript.queueSends ?? [];
      if (sends.find((entry) => entry.itemId === next.itemId) !== before) return current;
      return { ...current, transcript: { ...current.transcript, queueSends: before
        ? sends.map((entry) => entry === before ? next : entry)
        : [...sends, next] } };
    });
  };
  const reconcile = (): void => {
    if (disposed) return;
    for (const [sessionId, session] of deps.store.getSnapshot().sessions) {
      for (const entry of session.transcript.queueSends ?? []) {
        if (entry.phase === "confirmed") continue;
        const live = session.stream.messages.find((message) => message.role === "user" && message.sourceMessageId === entry.itemId);
        const durable = session.transcript.page.messages?.find((message) => message.role === "user" && message.sourceMessageId === entry.itemId);
        const messageId = live?.id ?? durable?.msgId;
        if (messageId) replace(sessionId, entry, { ...entry, phase: "confirmed", messageId, error: undefined });
      }
    }
  };
  return {
    start: () => { if (!disposed && !unsubscribe) { unsubscribe = deps.store.subscribe(reconcile); reconcile(); } },
    send: async (input: { readonly sessionId: string; readonly itemId: string }): Promise<void> => {
      if (disposed || deps.store.isDisposed()) return;
      const before = deps.store.readSession(input.sessionId).transcript.queueSends?.find((entry) => entry.itemId === input.itemId);
      if (before && before.phase !== "failed") return;
      const queued = deps.readQueued(input.sessionId, input.itemId);
      if (!before && (!queued || queued.status !== "queued")) throw new Error("Queued input is no longer available.");
      const pending: WebuiQueueSend = { itemId: input.itemId, content: before?.content ?? queued?.content ?? "", phase: "pending" };
      replace(input.sessionId, before, pending);
      try {
        await deps.submit(input);
        replace(input.sessionId, pending, { ...pending, phase: "accepted" });
      } catch (error) {
        // A connection/timeout or malformed acknowledgement cannot establish non-delivery.
        const refused = isWebuiWireError(error) && ["invalid_request", "unknown_operation", "shutting_down"].includes(error.code);
        replace(input.sessionId, pending, { ...pending, phase: refused ? "failed" : "unknown", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      reconcile();
    },
    transcriptRewound: (sessionId: string): void => {
      for (const entry of deps.store.readSession(sessionId).transcript.queueSends ?? []) {
        if (entry.phase !== "pending" && entry.phase !== "accepted") continue;
        replace(sessionId, entry, { ...entry, phase: "unknown", error: "会话已回退，尚未确认此输入的处理结果" });
      }
    },
    recheck: async (sessionId: string): Promise<void> => {
      if (disposed || deps.store.isDisposed()) return;
      await deps.refreshHistory(sessionId);
      reconcile();
    },
    dispose: () => { disposed = true; unsubscribe?.(); unsubscribe = undefined; },
  };
}
