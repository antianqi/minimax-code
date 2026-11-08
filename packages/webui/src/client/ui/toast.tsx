// The shared toast: the client's one transient notice.
//
// A toast says something that has already happened — "已保存", "复制失败",
// "远程连接已保存" — and then goes away. It exists because the alternative was
// worse. The client used to write the same answer into the page: the notice
// took room, pushed the content below it down, and stayed there long after the
// moment had passed. A notice that occupies space is a page state pretending to
// be a message.
//
// What belongs here: the queue, the lifetimes, the tone, the shape, and the
// announcement. What belongs to the caller: the words, the tone, the action.
//
// This is deliberately not a managed overlay. A toast is not dismissed by
// Escape and it never takes focus: it says its piece and leaves. Registering
// it with the overlay coordinator would make it a layer the user has to
// dismiss, and a toast the user has to dismiss is a dialog.

import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useWebuiBrowserCapabilities } from "../bindings/browser-capabilities.js";
import { WebuiButton, WebuiIconButton } from "./button.js";
import {
  createWebuiToastEntry,
  reduceWebuiToasts,
  webuiToastIdentity,
  type WebuiToastAction,
  type WebuiToastEntry,
  type WebuiToastRequest,
  type WebuiToastTone,
} from "./toast-store.js";

/**
 * How long the exit animation runs.
 *
 * The stylesheet reads the same number through the shared surface-exit token,
 * and the card is unmounted when the animation that fades it out has finished.
 */
export const WEBUI_TOAST_EXIT_MS = 120;

/** What a caller may add to a tone. */
export type WebuiToastOptions = Omit<WebuiToastRequest, "message" | "tone">;

/** What a caller asks the client to say. */
export interface WebuiToastController {
  /** Say something, in a tone the caller names. Returns the toast's id. */
  readonly show: (request: WebuiToastRequest) => string;
  readonly info: (message: ReactNode, options?: WebuiToastOptions) => string;
  readonly success: (message: ReactNode, options?: WebuiToastOptions) => string;
  readonly warning: (message: ReactNode, options?: WebuiToastOptions) => string;
  readonly error: (message: ReactNode, options?: WebuiToastOptions) => string;
  /** Let one toast go. */
  readonly dismiss: (id: string) => void;
  /** Let every toast go. */
  readonly dismissAll: () => void;
}

interface WebuiToastContextValue extends WebuiToastController {
  readonly entries: readonly WebuiToastEntry[];
  /** Hold a toast's countdown while the reader is on it. */
  readonly pause: (id: string) => void;
  /** Let a held toast's countdown run again. */
  readonly resume: (id: string) => void;
}

const WebuiToastContext = createContext<WebuiToastContextValue | null>(null);

/** The glyph each tone reads with. */
const TONE_ICON: Readonly<Record<WebuiToastTone, typeof IconInfoCircle>> = {
  info: IconInfoCircle,
  success: IconCircleCheck,
  warning: IconAlertTriangle,
  error: IconAlertCircle,
};

/**
 * The card's class, one name per tone.
 *
 * The names are written out rather than composed from the tone, because the
 * stylesheet's component layer is pruned against the sources that use it: a
 * class name that only ever appears inside a template literal is a class the
 * build drops, and a toast without its rail is a toast that says nothing about
 * which kind of notice it is.
 */
const TONE_CLASS: Readonly<Record<WebuiToastTone, string>> = {
  info: "webui-toast--info",
  success: "webui-toast--success",
  warning: "webui-toast--warning",
  error: "webui-toast--error",
};

interface ToastTimer {
  readonly kind: "dismiss" | "remove";
  readonly handle: ReturnType<typeof setTimeout>;
  /** How much of the countdown is left when it is paused. */
  readonly remainingMs: number;
  readonly startedAt: number;
}

/**
 * The queue and the timers that empty it.
 *
 * The provider owns the queue; the store in `toast-store.ts` owns the rules
 * about what the queue does. This half is the part React is for: the timers,
 * and the moment a card leaves the page.
 */
export function WebuiToastProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const [entries, setEntries] = useState<readonly WebuiToastEntry[]>([]);
  const entriesRef = useRef<readonly WebuiToastEntry[]>(entries);
  const timersRef = useRef(new Map<string, ToastTimer>());
  const heldRef = useRef(new Map<string, number>());
  const counterRef = useRef(0);

  const apply = useCallback((next: readonly WebuiToastEntry[]): void => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const dismiss = useCallback(
    (id: string): void => {
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer.handle);
        timersRef.current.delete(id);
      }
      heldRef.current.delete(id);
      apply(reduceWebuiToasts({ entries: entriesRef.current }, { type: "leave", id }).entries);
    },
    [apply],
  );

  const remove = useCallback(
    (id: string): void => {
      apply(reduceWebuiToasts({ entries: entriesRef.current }, { type: "remove", id }).entries);
    },
    [apply],
  );

  const show = useCallback(
    (request: WebuiToastRequest): string => {
      const tone = request.tone ?? "info";
      const identity = webuiToastIdentity(tone, request.message, request.description);
      const repeated =
        identity === undefined
          ? undefined
          : entriesRef.current.find(
              (entry) => entry.identity === identity && entry.phase === "visible",
            );
      const id = repeated?.id ?? `webui-toast-${(counterRef.current += 1)}`;
      const entry = createWebuiToastEntry(request, id);
      // A notice that is said twice is said once, and the countdown of the
      // notice that was already on screen starts again: the second saying is
      // news.
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer.handle);
        timersRef.current.delete(id);
      }
      heldRef.current.delete(id);
      apply(reduceWebuiToasts({ entries: entriesRef.current }, { type: "show", entry }).entries);
      return id;
    },
    [apply],
  );

  const dismissAll = useCallback((): void => {
    for (const entry of entriesRef.current) {
      if (entry.phase === "visible") dismiss(entry.id);
    }
  }, [dismiss]);

  const pause = useCallback((id: string): void => {
    const timer = timersRef.current.get(id);
    if (!timer || timer.kind !== "dismiss") return;
    clearTimeout(timer.handle);
    timersRef.current.delete(id);
    heldRef.current.set(
      id,
      Math.max(0, timer.remainingMs - (Date.now() - timer.startedAt)),
    );
  }, []);

  const resume = useCallback((id: string): void => {
    const remaining = heldRef.current.get(id);
    if (remaining === undefined) return;
    heldRef.current.delete(id);
    const handle = setTimeout(() => {
      timersRef.current.delete(id);
      dismiss(id);
    }, remaining);
    timersRef.current.set(id, {
      kind: "dismiss",
      handle,
      remainingMs: remaining,
      startedAt: Date.now(),
    });
  }, [dismiss]);

  // The timers follow the queue: a card on screen counts down, a card on its
  // way out is unmounted when its animation has finished, and a card that is
  // gone leaves no timer behind.
  useEffect(() => {
    const timers = timersRef.current;
    const held = heldRef.current;
    const keep = new Set<string>();
    for (const entry of entries) {
      keep.add(entry.id);
      if (held.has(entry.id)) continue;
      if (timers.has(entry.id)) continue;
      if (entry.phase === "leaving") {
        const handle = setTimeout(() => {
          timers.delete(entry.id);
          remove(entry.id);
        }, WEBUI_TOAST_EXIT_MS);
        timers.set(entry.id, {
          kind: "remove",
          handle,
          remainingMs: WEBUI_TOAST_EXIT_MS,
          startedAt: Date.now(),
        });
        continue;
      }
      if (entry.durationMs <= 0) continue;
      const handle = setTimeout(() => {
        timers.delete(entry.id);
        dismiss(entry.id);
      }, entry.durationMs);
      timers.set(entry.id, {
        kind: "dismiss",
        handle,
        remainingMs: entry.durationMs,
        startedAt: Date.now(),
      });
    }
    for (const [id, timer] of timers) {
      if (keep.has(id)) continue;
      clearTimeout(timer.handle);
      timers.delete(id);
    }
  }, [entries, dismiss, remove]);

  const say = useCallback(
    (tone: WebuiToastTone) =>
      (message: ReactNode, options?: WebuiToastOptions): string =>
        show({
          tone,
          message,
          ...(options?.description === undefined ? {} : { description: options.description }),
          ...(options?.action === undefined ? {} : { action: options.action }),
          ...(options?.testId === undefined ? {} : { testId: options.testId }),
          ...(options?.dataAttributes === undefined ? {} : { dataAttributes: options.dataAttributes }),
          ...(options?.durationMs === undefined ? {} : { durationMs: options.durationMs }),
        }),
    [show],
  );

  const value = useMemo<WebuiToastContextValue>(
    () => ({
      entries,
      show,
      info: say("info"),
      success: say("success"),
      warning: say("warning"),
      error: say("error"),
      dismiss,
      dismissAll,
      pause,
      resume,
    }),
    [entries, show, say, dismiss, dismissAll, pause, resume],
  );

  return <WebuiToastContext.Provider value={value}>{children}</WebuiToastContext.Provider>;
}

/**
 * The queue, for a surface that renders the toasts itself.
 *
 * The host is the usual answer; this is for a client that wants its own
 * placement.
 */
export function useWebuiToastEntries(): readonly WebuiToastEntry[] {
  return useWebuiToastContext().entries;
}

/**
 * The controller a surface gets when no queue is mounted.
 *
 * The client mounts the queue once per document, at the composition root, so a
 * surface rendered on its own — a server render, an isolated preview — reaches
 * this controller instead. The notice is raised and remembered, and the client
 * is told once that there was nowhere to draw it: a missing queue is a wiring
 * mistake, and it must not be the reason a surface fails to render.
 */
function createUnhostedToastController(): WebuiToastController {
  const notices: string[] = [];
  let warned = false;
  const show = (request: WebuiToastRequest): string => {
    if (!warned) {
      warned = true;
      console.warn(
        "[webui] a toast was raised with no toast queue mounted; nothing will draw it",
      );
    }
    const id = `webui-toast-unhosted-${notices.length + 1}`;
    notices.push(id);
    if (notices.length > 20) notices.shift();
    return id;
  };
  const say = (tone: WebuiToastTone) => (message: ReactNode): string =>
    show({ tone, message });
  return {
    show,
    info: say("info"),
    success: say("success"),
    warning: say("warning"),
    error: say("error"),
    dismiss: () => undefined,
    dismissAll: () => undefined,
  };
}

const unhostedToastController = createUnhostedToastController();

/**
 * The client-wide way to say something.
 *
 * A surface renders inside the queue the composition root mounts, so this is the
 * queue's controller. A surface rendered on its own gets the unhosted one
 * instead of an exception: losing a notice is a wiring mistake to report, and
 * it is not a reason to take the surface down with it.
 */
export function useWebuiToast(): WebuiToastController {
  return useContext(WebuiToastContext) ?? unhostedToastController;
}

function useWebuiToastContext(): WebuiToastContextValue {
  const value = useContext(WebuiToastContext);
  if (!value) {
    throw new Error("the toast host must be rendered within a WebuiToastProvider");
  }
  return value;
}

/** What a notice carries besides its message. */
export interface WebuiToastNoticeOptions {
  readonly tone?: WebuiToastTone;
  readonly description?: ReactNode;
  readonly action?: WebuiToastAction;
  /** The selector the card carries, so a caller can still address the notice. */
  readonly testId?: string;
  /** The surface's own markers, carried onto the card. */
  readonly dataAttributes?: Readonly<Record<string, string>>;
}

/**
 * Say a message once, when it appears.
 *
 * The hook is the migration's other half: a surface that keeps a notice in its
 * state and then renders it inline spends layout on a moment that is already
 * over. This says the notice and leaves the layout alone. The caller keeps the
 * state, because the state is what a retry and a re-render need.
 *
 * The message is a string on purpose. A notice whose content is an element has
 * a new identity on every render, so "say it when it changes" would say it
 * again on every render; a string is comparable, so the notice is said when it
 * changes and only then. A caller that needs richer content says it through
 * `useWebuiToast().show` instead.
 *
 * The options are read through a ref, so a caller that builds its action
 * afresh on every render does not restart the notice.
 */
function useWebuiToastNotice(
  message: string | undefined | null,
  options: WebuiToastNoticeOptions = {},
  tone: WebuiToastTone = "info",
): void {
  const { show } = useWebuiToast();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    if (message === undefined || message === null || message === "") return;
    const current = optionsRef.current;
    show({
      tone: current.tone ?? tone,
      message,
      ...(current.description === undefined ? {} : { description: current.description }),
      ...(current.action === undefined ? {} : { action: current.action }),
      ...(current.testId === undefined ? {} : { testId: current.testId }),
      ...(current.dataAttributes === undefined ? {} : { dataAttributes: current.dataAttributes }),
    });
  }, [message, show, tone]);
}

/** Say a failure once, when it appears, instead of writing it into the page. */
export function useWebuiToastError(
  error: string | undefined | null,
  options: Omit<WebuiToastNoticeOptions, "tone"> = {},
): void {
  useWebuiToastNotice(error, options, "error");
}

/** Say a confirmation once, when it appears. */
export function useWebuiToastSuccess(
  message: string | undefined | null,
  options: Omit<WebuiToastNoticeOptions, "tone"> = {},
): void {
  useWebuiToastNotice(message, options, "success");
}

/**
 * One toast.
 *
 * The card is the message, the tone's glyph and — when the notice asks
 * something — the action that answers it. The close button is there because a
 * notice the user wants gone is a notice the user can dismiss; the countdown
 * only covers the cases where the user is not looking.
 */
export function WebuiToast({
  entry,
  onDismiss,
  onPause,
  onResume,
}: {
  readonly entry: WebuiToastEntry;
  readonly onDismiss: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
}): ReactElement {
  const Icon = TONE_ICON[entry.tone];
  const leaving = entry.phase === "leaving";
  return (
    <div
      className={`webui-toast ${TONE_CLASS[entry.tone]} webui-motion`}
      // The notice is announced once, by the card that carries it. An error
      // interrupts; the rest wait their turn.
      role={entry.tone === "error" ? "alert" : "status"}
      data-webui-toast="true"
      data-webui-toast-tone={entry.tone}
      data-webui-toast-leaving={leaving ? "true" : "false"}
      data-testid={entry.testId ?? "webui-toast"}
      {...(entry.dataAttributes ?? {})}
      // The shared surface motion, applied by hand rather than through
      // `WebuiMotion`: that wrapper projects a skeleton while the page is
      // loading, and a notice that turns into a placeholder is a notice the
      // user cannot read.
      data-webui-motion="surface"
      data-webui-motion-state={leaving ? "exit" : "enter"}
      data-webui-motion-direction="down"
      onPointerEnter={onPause}
      onPointerLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={onResume}
    >
      <span className="webui-toast-icon" aria-hidden="true">
        <Icon size={16} stroke={2} />
      </span>
      <div className="webui-toast-body">
        {/* The message is keyed on the revision, so a notice that is said
         * twice is announced twice: the region only announces what changed
         * inside it, and a refresh that leaves the words in place would be
         * heard once. The card itself is not re-keyed, so the second saying
         * does not animate in again. */}
        <p className="webui-toast-message" key={entry.revision}>{entry.message}</p>
        {entry.description === undefined ? null : (
          <p className="webui-toast-description" key={`description-${entry.revision}`}>{entry.description}</p>
        )}
        {entry.action === undefined ? null : (
          <div className="webui-toast-action">
            <WebuiButton
              variant="quiet-highlight"
              size="inline"
              onClick={() => {
                entry.action?.onClick();
                onDismiss();
              }}
            >
              {entry.action.label}
            </WebuiButton>
          </div>
        )}
      </div>
      <WebuiIconButton
        label="关闭"
        tone="bare"
        size="compact"
        className="webui-toast-close"
        onClick={onDismiss}
      >
        <IconX size={14} stroke={1.8} />
      </WebuiIconButton>
    </div>
  );
}

/**
 * Where the toasts are shown.
 *
 * The host is portalled into the document body and positioned against the
 * viewport, so a notice never takes room from the page it is about and never
 * moves the content it interrupts. The stack holds a few toasts and the oldest
 * leaves when it grows past that; the rule is the store's, not this module's.
 */
export function WebuiToastHost(): ReactElement | null {
  const { entries, dismiss, pause, resume } = useWebuiToastContext();
  const portalTarget = useWebuiBrowserCapabilities().dom.portalTarget();
  if (!portalTarget) return null;
  return createPortal(
    <div
      className="webui-toast-host"
      data-webui-toast-host="true"
      // A notice crosses a modal: the failure it reports may well have
      // happened inside one, and a modal that made the notice inert would
      // silence the very announcement it exists to deliver.
      data-webui-live-surface="true"
    >
      {entries.map((entry) => (
        <WebuiToast
          key={entry.id}
          entry={entry}
          onDismiss={() => dismiss(entry.id)}
          onPause={() => pause(entry.id)}
          onResume={() => resume(entry.id)}
        />
      ))}
    </div>,
    portalTarget,
  );
}
