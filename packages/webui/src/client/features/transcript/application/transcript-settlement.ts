import type { WebuiSessionStore } from "../../../application/session-store.js";
import type { WebuiStreamMessage, WebuiStreamState } from "../../turn/contracts/stream-state.js";
import { isTurnLive } from "../../turn/contracts/stream-state.js";
import type { WebuiTranscriptHistoryOwner } from "../../../conversation/transcript-history.js";
import type { WebuiClientMessagePage } from "../contracts/message-view.js";
import { isWebuiObservedMessagePersisted } from "../projection/settled-turn.js";

export interface WebuiTranscriptSettlementOwner {
  readonly start: () => void;
  readonly retry: (sessionId: string) => void;
  readonly invalidate: (sessionId: string, options?: { readonly preserveCurrentStream?: boolean }) => void;
  readonly releaseSession: (sessionId: string) => void;
  readonly dispose: () => void;
}

interface SettlementAttempt {
  stream?: WebuiStreamState;
  page?: WebuiClientMessagePage;
  reads: number;
  inFlight: boolean;
  cancel?: () => void;
}

/** Content synchronization belongs to the application, independently of mounted views. */
export function createWebuiTranscriptSettlementOwner(deps: {
  readonly store: WebuiSessionStore;
  readonly history: WebuiTranscriptHistoryOwner;
  readonly setTimer?: (callback: () => void, delayMs: number) => () => void;
}): WebuiTranscriptSettlementOwner {
  const { store, history } = deps;
  const setTimer = deps.setTimer ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  });
  const attempts = new Map<string, SettlementAttempt>();
  let unsubscribe: (() => void) | undefined;
  let disposed = false;
  let reconciling = false;
  let dirty = false;

  const releaseSession = (sessionId: string): void => {
    attempts.get(sessionId)?.cancel?.();
    attempts.delete(sessionId);
  };

  const refresh = (sessionId: string, attempt: SettlementAttempt): void => {
    if (disposed || attempts.get(sessionId) !== attempt || attempt.inFlight) return;
    attempt.cancel?.();
    attempt.cancel = undefined;
    attempt.inFlight = true;
    attempt.reads += 1;
    void history.synchronizePage(sessionId).finally(() => {
      if (disposed || attempts.get(sessionId) !== attempt) return;
      attempt.inFlight = false;
      reconcile();
    });
  };

  const reconcile = (): void => {
    if (disposed) return;
    dirty = true;
    if (reconciling) return;
    reconciling = true;
    try {
      while (dirty) {
        dirty = false;
        const sessions = store.getSnapshot().sessions;
        for (const sessionId of attempts.keys()) if (!sessions.has(sessionId)) releaseSession(sessionId);
        for (const [sessionId, session] of sessions) {
          let attempt = attempts.get(sessionId);
          if (!attempt) {
            attempt = { reads: 0, inFlight: false };
            attempts.set(sessionId, attempt);
          }
          const { stream, transcript } = session;
          let retained = transcript.retainedMessages ?? [];
          const streamChanged = attempt.stream !== stream;
          const pageChanged = attempt.page !== transcript.page;
          if (streamChanged || pageChanged) {
            if (stream.historyReplacement !== undefined && stream.historyReplacement !== attempt.stream?.historyReplacement) retained = [];
            const messages = new Map(retained.map((message) => [message.id, message]));
            if (streamChanged && stream.messageSource !== "history") for (const message of stream.messages) {
              // Goal-event bubbles are transient projections, not durable message identities.
              if (message.isGoal && message.id.startsWith("thread-goal-")) continue;
              messages.set(message.id, message);
            }
            const persisted = new Map((transcript.page.messages ?? []).map((message) => [message.msgId, message]));
            const next = [...messages.values()].filter((message) => {
              const durable = persisted.get(message.id);
              return !durable || !isWebuiObservedMessagePersisted(message, durable);
            });
            if (next.length !== retained.length || next.some((message, index) => message !== retained[index])) retained = next;
            attempt.stream = stream;
            attempt.page = transcript.page;
            if (streamChanged && !isTurnLive(stream.phase)) attempt.reads = 0;
          }
          const activeIds = isTurnLive(stream.phase) ? new Set(stream.messages.map((message) => message.id)) : undefined;
          const pending = retained.some((message) => !activeIds?.has(message.id));
          const phase = pending ? (attempt.reads >= 4 && !attempt.inFlight ? "failed" : transcript.synchronization?.phase === "failed" ? "failed" : "pending") : undefined;
          if ((retained !== transcript.retainedMessages && (retained.length > 0 || transcript.retainedMessages !== undefined)) || phase !== transcript.synchronization?.phase) {
            store.updateSession(sessionId, (current) => ({
              ...current,
              transcript: {
                ...current.transcript,
                retainedMessages: retained,
                synchronization: phase ? { phase, ...(phase === "failed" ? { error: current.transcript.error ?? "History has not confirmed the observed reply content." } : {}) } : undefined,
              },
            }));
          }
          if (!pending) {
            attempt.cancel?.();
            attempt.cancel = undefined;
            attempt.reads = 0;
          } else if (!attempt.inFlight && !attempt.cancel) {
            if (attempt.reads === 0) refresh(sessionId, attempt);
            else {
              const target = attempt;
              attempt.cancel = setTimer(() => {
                target.cancel = undefined;
                refresh(sessionId, target);
              }, phase === "failed" ? 5_000 : 700);
            }
          }
        }
      }
    } finally {
      reconciling = false;
    }
  };

  return {
    start: () => {
      if (disposed || unsubscribe) return;
      unsubscribe = store.subscribe(reconcile);
      reconcile();
    },
    retry: (sessionId) => {
      const attempt = attempts.get(sessionId);
      if (!attempt || disposed) return;
      attempt.cancel?.();
      attempt.cancel = undefined;
      attempt.reads = 0;
      store.updateSession(sessionId, (current) => ({ ...current, transcript: { ...current.transcript, synchronization: { phase: "pending" } } }));
      reconcile();
    },
    invalidate: (sessionId, options) => {
      releaseSession(sessionId);
      const current = store.readSession(sessionId);
      attempts.set(sessionId, { stream: current.stream, page: current.transcript.page, reads: 0, inFlight: false });
      store.updateSession(sessionId, (current) => ({
        ...current,
        transcript: {
          ...current.transcript,
          retainedMessages: options?.preserveCurrentStream ? current.stream.messages : [],
          synchronization: undefined,
        },
      }));
    },
    releaseSession,
    dispose: () => {
      disposed = true;
      unsubscribe?.();
      for (const sessionId of attempts.keys()) releaseSession(sessionId);
    },
  };
}
