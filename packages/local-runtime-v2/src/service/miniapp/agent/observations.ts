// The watches an `agent.observe` call opens, and the turns they are fed.
//
// A page asks to watch every conversation or one conversation. That is a long-lived
// subscription, not a request: it has no result, it ends when the page cancels it or the
// frame goes away, and the events arrive in the shape the page's own code reads.
//
// The turn system publishes; this file only decides who hears it. Keeping the decision
// here is what lets the same event reach a page whoever started the turn, and it keeps
// the lifetime question (one cancel, one settle, no events afterwards) in one place.

export interface MiniAppAgentObservationEvent {
  readonly type: "turn.finished";
  readonly sessionId: string;
  readonly turnId: string;
  readonly title: string;
  readonly outcome: string;
}

/** What a turn looks like at the moment it settles, before it is given a type. */
export interface MiniAppAgentTurnSettlement {
  readonly sessionId: string;
  readonly turnId: string;
  readonly title: string;
  readonly outcome: string;
}

export interface MiniAppAgentObservationTarget {
  readonly pluginId: string;
  /** The handle the page cancels with. Unique across every watch, not per plugin. */
  readonly requestId: string;
  /** Every conversation, or just `sessionId`. */
  readonly all?: boolean;
  readonly sessionId?: string;
}

export interface MiniAppAgentObservationOptions {
  readonly onEvent: (event: MiniAppAgentObservationEvent) => void;
  /** Aborting is the frame going away; the watch ends the same way a cancel does. */
  readonly signal?: AbortSignal;
}

export interface MiniAppAgentObservations {
  /** Resolves when the watch ends. Throws `busy` when the id is already taken. */
  subscribe(
    target: MiniAppAgentObservationTarget,
    options: MiniAppAgentObservationOptions,
  ): Promise<void>;
  /** Ends the watch this plugin opened under this id. False when there is none. */
  cancel(pluginId: string, requestId: string): boolean;
  publish(settlement: MiniAppAgentTurnSettlement): void;
  /** How many watches are live. For the runtime's own teardown check. */
  count(): number;
}

interface Watch {
  readonly target: MiniAppAgentObservationTarget;
  readonly onEvent: (event: MiniAppAgentObservationEvent) => void;
  readonly settle: () => void;
}

export function createMiniAppAgentObservations(): MiniAppAgentObservations {
  const watches = new Map<string, Watch>();

  return {
    subscribe(target, options) {
      // The id is the only handle the page can cancel with, so two watches sharing one
      // would make a cancel pick a victim. The page is told `busy` and decides.
      if (watches.has(target.requestId)) {
        throw Object.assign(new Error("busy"), { code: "busy" });
      }

      return new Promise<void>((resolve) => {
        let settled = false;
        const settle = (): void => {
          if (settled) return;
          settled = true;
          watches.delete(target.requestId);
          options.signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const onAbort = (): void => settle();

        watches.set(target.requestId, { target, onEvent: options.onEvent, settle });

        if (options.signal) {
          if (options.signal.aborted) onAbort();
          else options.signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    },

    cancel(pluginId, requestId) {
      const watch = watches.get(requestId);
      if (!watch || watch.target.pluginId !== pluginId) return false;
      watch.settle();
      return true;
    },

    publish(settlement) {
      const event: MiniAppAgentObservationEvent = { type: "turn.finished", ...settlement };

      // Copied before iterating: a listener may cancel itself, and a watch cancelled by
      // the settlement must not be fed the settlement that ended it.
      for (const watch of [...watches.values()]) {
        const { target } = watch;
        if (!target.all && target.sessionId !== settlement.sessionId) continue;
        try {
          watch.onEvent(event);
        } catch {
          // The page's own handler failing is the page's problem. The other pages
          // watching the same conversation still get their event.
        }
      }
    },

    count() {
      return watches.size;
    },
  };
}
