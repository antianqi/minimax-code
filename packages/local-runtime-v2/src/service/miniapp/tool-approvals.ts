// The prompt a page's `ask` waits on: one pending item per request, one answer per item.
//
// The gateway decides *that* a tool asks; this decides what asking looks like while
// nobody has answered. Four properties, each a decision:
//
//   * **An unanswered prompt is a refusal.** When nobody answers in time the answer is
//     `deny`, never a silent allow. `unavailable` is reserved for "nobody could be
//     asked at all" — an aborted request, or a Host with no prompt — because the gateway
//     tells the page something different for each.
//   * **One answer settles one request.** An id that is gone is not re-settled: a second
//     answer cannot flip a decision that already reached the tool.
//   * **A pending item is a snapshot.** Listeners receive the list as it is now, so a
//     client that connects late renders the same thing as one that connected first.
//   * **The prompt is not the plugin's.** `pluginId` travels so a client can say what is
//     asking; nothing here decides on the plugin's behalf.
//
// The prompt's own rendering, and how a person's click becomes `answer(...)`, are the
// client's and the wire's business.

import { randomUUID } from 'node:crypto';

import type {
  MiniAppToolApprovalDecision,
  MiniAppToolApprovalItem,
  MiniAppToolApprovalOutcome,
  MiniAppToolApprovalPort,
  MiniAppToolApprovalRequest,
} from './tool-permission.js';

/** One prompt a person has not answered yet. */
export interface MiniAppToolApprovalPending {
  readonly requestId: string;
  readonly mode: 'call' | 'request';
  readonly pluginId: string;
  readonly tools: readonly MiniAppToolApprovalItem[];
}

export interface MiniAppToolApprovalAnswer {
  readonly requestId: string;
  /**
   * The package the answer is given for.
   *
   * When present the prompt must belong to it: a client that can frame one Mini App
   * must not settle another's prompt, and the client knows which one it is showing.
   */
  readonly pluginId?: string;
  readonly decision: MiniAppToolApprovalDecision;
  /** The tools ticked in a `request` prompt. */
  readonly names?: readonly string[];
}

export interface MiniAppToolApprovals extends MiniAppToolApprovalPort {
  /** The prompts waiting now, oldest first. */
  pending(): readonly MiniAppToolApprovalPending[];
  /** Settles one prompt. False when the id is not waiting any more. */
  answer(answer: MiniAppToolApprovalAnswer): boolean;
  /** Told the pending list whenever it changes. */
  subscribe(listener: (pending: readonly MiniAppToolApprovalPending[]) => void): () => void;
}

export interface MiniAppToolApprovalsOptions {
  /** How long a prompt waits before it becomes a refusal. */
  readonly timeoutMs?: number;
}

/** Long enough for a person to read a tool name and decide; bounded so a call cannot hang. */
const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;

export function createMiniAppToolApprovals(
  options: MiniAppToolApprovalsOptions = {},
): MiniAppToolApprovals {
  const timeoutMs = options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  const waiting = new Map<
    string,
    {
      readonly pending: MiniAppToolApprovalPending;
      readonly settle: (outcome: MiniAppToolApprovalOutcome) => void;
      readonly abort: () => void;
    }
  >();
  const listeners = new Set<(pending: readonly MiniAppToolApprovalPending[]) => void>();

  const snapshot = (): readonly MiniAppToolApprovalPending[] =>
    [...waiting.values()].map((entry) => entry.pending);

  const publish = (): void => {
    const pending = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(pending);
      } catch {
        // A client that fails to render is not a reason to drop the prompt.
      }
    }
  };

  return {
    pending: snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    answer(input) {
      const entry = waiting.get(input.requestId);
      if (!entry) return false;
      if (input.pluginId !== undefined && input.pluginId !== entry.pending.pluginId) return false;
      waiting.delete(input.requestId);
      entry.abort();
      entry.settle({
        decision: input.decision,
        ...(input.names !== undefined ? { names: [...input.names] } : {}),
      });
      publish();
      return true;
    },

    request(input: MiniAppToolApprovalRequest): Promise<MiniAppToolApprovalOutcome> {
      // Asked and aborted is nobody to ask: the gateway turns this into
      // `TOOL_APPROVAL_REQUIRED`, which is not the same answer as a refusal.
      if (input.signal?.aborted) return Promise.resolve('unavailable');

      const requestId = randomUUID();
      const pending: MiniAppToolApprovalPending = {
        requestId,
        mode: input.mode,
        pluginId: input.pluginId,
        tools: input.tools,
      };

      return new Promise<MiniAppToolApprovalOutcome>((resolve) => {
        let settled = false;
        const finish = (outcome: MiniAppToolApprovalOutcome): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          input.signal?.removeEventListener('abort', onAbort);
          waiting.delete(requestId);
          resolve(outcome);
        };
        const onAbort = (): void => {
          const wasWaiting = waiting.delete(requestId);
          if (wasWaiting) publish();
          finish('unavailable');
        };
        const timer = setTimeout(() => {
          const wasWaiting = waiting.delete(requestId);
          if (wasWaiting) publish();
          finish({ decision: 'deny' });
        }, timeoutMs);
        timer.unref?.();
        input.signal?.addEventListener('abort', onAbort, { once: true });

        waiting.set(requestId, {
          pending,
          settle: (outcome) => resolve(outcome),
          abort: () => {
            clearTimeout(timer);
            input.signal?.removeEventListener('abort', onAbort);
            settled = true;
          },
        });
        publish();
      });
    },
  };
}
