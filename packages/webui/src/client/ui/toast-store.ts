// The toast queue's decisions, kept free of React so the rules that matter —
// one entry per identity, the cap on a visible stack, a toast's lifetime — are
// testable without a renderer.
//
// The toast is the client's answer to a question the feedback family cannot
// answer: a notice that has a moment and then goes away. `FeedbackError` is a
// state — the surface is broken, and it stays broken until it is fixed — so it
// belongs next to the thing that failed. A toast is an event: "保存失败",
// "已复制", "远程连接已保存". It is said once, it is heard once, and it does not
// push the page around while it is there.
//
// What belongs here: the vocabulary of a toast, the rules about how long it
// lives and when a second one replaces the first, and the queue's transitions.
// What belongs to the caller: the words, the tone, the action.

import type { ReactNode } from "react";

/**
 * How a toast reads.
 *
 * The tone is the one thing every caller agrees on, and it is what decides the
 * colour, the glyph and how loudly the toast is announced. `error` is the only
 * tone that interrupts: it is announced assertively, because a failure the user
 * does not hear is a failure that happens again.
 */
export type WebuiToastTone = "info" | "success" | "warning" | "error";

/** The action a toast offers. A toast with an action waits to be answered. */
export interface WebuiToastAction {
  readonly label: ReactNode;
  readonly onClick: () => void;
}

/**
 * How long each tone stays on its own.
 *
 * The numbers are the family's, not a caller's: a confirmation is read at a
 * glance and can go quickly, a failure carries a sentence the user may have to
 * read twice.
 */
export const WEBUI_TOAST_DURATION_MS: Readonly<Record<WebuiToastTone, number>> = {
  info: 4000,
  success: 3000,
  warning: 5000,
  error: 6000,
};

/**
 * How many toasts may be on screen at once.
 *
 * A toast that stacks without a limit is a second page of content: the stack
 * grows downward, the bottom of it goes off the screen, and the user is left
 * reading the oldest message while the newest one is the only one that matters.
 * The oldest is the one that leaves.
 */
export const WEBUI_TOAST_MAX_VISIBLE = 4;

/** One toast in the queue. */
export interface WebuiToastEntry {
  readonly id: string;
  readonly tone: WebuiToastTone;
  readonly message: ReactNode;
  readonly description?: ReactNode;
  readonly action?: WebuiToastAction;
  /** The selector the card carries, so a caller can still address the notice. */
  readonly testId?: string;
  /** The surface's own markers, passed through onto the card. */
  readonly dataAttributes?: Readonly<Record<string, string>>;
  /**
   * Milliseconds before the toast leaves on its own.
   *
   * Zero keeps it until the user dismisses it, which is what a toast with an
   * action needs: a retry the user has not reached yet must not disappear.
   */
  readonly durationMs: number;
  /**
   * The text this toast repeats, when its message is plain text.
   *
   * `undefined` means "never repeats": the message is not text, so there is
   * nothing to compare, and two different messages must not collapse into one.
   */
  readonly identity: string | undefined;
  /**
   * `leaving` is how the exit animation says "still mounted, on its way out".
   *
   * The entry is not removed the moment it is dismissed, because a toast that
   * vanishes in one frame reads as a glitch rather than as a dismissal.
   */
  readonly phase: "visible" | "leaving";
}

/** What a caller asks the client to say. */
export interface WebuiToastRequest {
  readonly tone?: WebuiToastTone;
  /** The one line the toast says. */
  readonly message: ReactNode;
  /** The second line, for a failure that carries its cause. */
  readonly description?: ReactNode;
  /** The action the toast offers. A toast with an action waits to be answered. */
  readonly action?: WebuiToastAction;
  /** The selector the card carries, so a caller can still address the notice. */
  readonly testId?: string;
  /** The surface's own markers, carried onto the card. */
  readonly dataAttributes?: Readonly<Record<string, string>>;
  /**
   * How long the toast stays. Zero keeps it until it is dismissed.
   *
   * Omitted, the tone decides — except for a toast with an action, which waits.
   */
  readonly durationMs?: number;
}

/**
 * The text of a message, when the message is text.
 *
 * A message that is an element has no text to compare, and `undefined` says so:
 * two different elements must not be treated as the same notice.
 */
function plainText(node: ReactNode): string | undefined {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    const parts: string[] = [];
    for (const child of node) {
      const text = plainText(child);
      if (text === undefined) return undefined;
      parts.push(text);
    }
    return parts.join("");
  }
  return undefined;
}

/**
 * What makes two toasts the same notice.
 *
 * The tone is part of it: "已保存" and "保存失败" are different facts even
 * when the words overlap.
 */
export function webuiToastIdentity(
  tone: WebuiToastTone,
  message: ReactNode,
  description?: ReactNode,
): string | undefined {
  const text = plainText(message);
  if (text === undefined) return undefined;
  return `${tone}\u0000${text}\u0000${plainText(description) ?? ""}`;
}

/**
 * How long a toast lives.
 *
 * A caller may say; otherwise a toast with an action waits for the answer, and
 * a toast without one is given the time its tone is worth.
 */
export function webuiToastDurationMs(
  tone: WebuiToastTone,
  hasAction: boolean,
  requested?: number,
): number {
  if (typeof requested === "number" && Number.isFinite(requested)) {
    return Math.max(0, Math.trunc(requested));
  }
  if (hasAction) return 0;
  return WEBUI_TOAST_DURATION_MS[tone];
}

/** One toast, as the queue holds it. */
export function createWebuiToastEntry(request: WebuiToastRequest, id: string): WebuiToastEntry {
  const tone = request.tone ?? "info";
  return {
    id,
    tone,
    message: request.message,
    ...(request.description === undefined ? {} : { description: request.description }),
    ...(request.action === undefined ? {} : { action: request.action }),
    ...(request.testId === undefined ? {} : { testId: request.testId }),
    ...(request.dataAttributes === undefined ? {} : { dataAttributes: request.dataAttributes }),
    durationMs: webuiToastDurationMs(tone, request.action !== undefined, request.durationMs),
    identity: webuiToastIdentity(tone, request.message, request.description),
    phase: "visible",
  };
}

/** The queue's state: the entries it holds, oldest first. */
export interface WebuiToastState {
  readonly entries: readonly WebuiToastEntry[];
}

/** What may happen to the queue. */
export type WebuiToastEvent =
  | { readonly type: "show"; readonly entry: WebuiToastEntry }
  | { readonly type: "leave"; readonly id: string }
  | { readonly type: "remove"; readonly id: string };

/**
 * How many toasts may be visible at once; the oldest leaves when there are too
 * many.
 */
function enforceWebuiToastCap(entries: readonly WebuiToastEntry[]): readonly WebuiToastEntry[] {
  let visible = 0;
  for (const entry of entries) {
    if (entry.phase === "visible") visible += 1;
  }
  if (visible <= WEBUI_TOAST_MAX_VISIBLE) return entries;
  let overflow = visible - WEBUI_TOAST_MAX_VISIBLE;
  return entries.map((entry) => {
    if (overflow <= 0) return entry;
    if (entry.phase !== "visible") return entry;
    overflow -= 1;
    return { ...entry, phase: "leaving" };
  });
}

/**
 * The queue's transitions.
 *
 * A notice that is said twice is said once: the second one refreshes the first
 * in place — same id, so the card does not animate in again — and the queue
 * grows by one only when the notice is a new one. The cap is applied after
 * every arrival, so a burst of failures cannot become a wall.
 */
export function reduceWebuiToasts(
  state: WebuiToastState,
  event: WebuiToastEvent,
): WebuiToastState {
  switch (event.type) {
    case "show": {
      const { entry } = event;
      const repeated =
        entry.identity === undefined
          ? -1
          : state.entries.findIndex(
              (candidate) =>
                candidate.identity === entry.identity && candidate.phase === "visible",
            );
      const entries =
        repeated >= 0
          ? state.entries.map((candidate, index) =>
              index === repeated ? { ...entry, id: candidate.id } : candidate,
            )
          : [...state.entries, entry];
      return { entries: enforceWebuiToastCap(entries) };
    }
    case "leave":
      return {
        entries: state.entries.map((entry) =>
          entry.id === event.id && entry.phase === "visible"
            ? { ...entry, phase: "leaving" }
            : entry,
        ),
      };
    case "remove":
      return { entries: state.entries.filter((entry) => entry.id !== event.id) };
    default:
      return state;
  }
}