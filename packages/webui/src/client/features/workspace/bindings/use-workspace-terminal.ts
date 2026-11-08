/**
 * The workspace panel's terminal binding: the roster, the xterm, and the calls
 * that keep the runtime's PTY in step with the browser's grid.
 *
 * The panel used to hold all of this itself, interleaved with its own sizing
 * state, tab composition and review rendering: a roster read with its own
 * monotonic counter, a mirrored list, a ready flag, an auto-create latch, the
 * grid measurement, the attach effect, the resize debounce and the reported-size
 * memo. None of it is layout. What the panel needs from it is four values — the
 * element to mount into, whether the roster has answered, whether a terminal is
 * bound to the active tab, and what to say when this host cannot provide one.
 *
 * Nothing here decides *when* the terminal tab is shown; the panel does, and
 * tells this binding through `active`. Nothing here mounts a PTY the panel did
 * not ask for: a terminal is created only for the active tab, once, in the same
 * place and under the same conditions as before.
 *
 * A view going away releases its watch and its xterm; it never kills a PTY.
 * Process death is the panel's explicit dispose button or the application's
 * disposal — that rule is why the unmount effect stops a watch instead of
 * calling `dispose` on the owner.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import type { WebuiTerminalOwner } from "../../terminal/contracts/terminal-owner.js";
import type { WebuiTerminalSupport, WebuiTerminalRecord } from "../../terminal/contracts/terminal-owner.js";
import {
  TERMINAL_RESIZE_DEBOUNCE_MS,
  terminalResizeRequest,
} from "../../terminal/projection/terminal-size.public.js";
import type { WebuiTerminalSize } from "../../terminal/contracts/terminal-port.js";
import type { WebuiWorkspaceTabKind } from "../projection/workspace-panel-state.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { useWebuiToastError } from "../../../ui/toast.js";

export interface UseWorkspaceTerminalOptions {
  /** The Terminal business's published owner; absent when this assembly has none. */
  readonly owner: WebuiTerminalOwner | undefined;
  /** The kind of tab the panel is showing. The terminal tab is the one this binds. */
  readonly tabKind: WebuiWorkspaceTabKind;
  /** The workspace tab the terminal belongs to, if one is selected. */
  readonly tabId: string | undefined;
  /** The workspace whose roster and future PTYs this is. */
  readonly workspaceDir: string | undefined;
}

export interface WorkspaceTerminal {
  /** The element xterm is opened into. */
  readonly hostRef: RefObject<HTMLDivElement>;
  /** The roster has answered once for this workspace. */
  readonly ready: boolean;
  /** A terminal is bound to the active tab, so the panel shows a live view. */
  readonly hasTerminal: boolean;
  /** What this host can do with terminals, as the owner observed it. */
  readonly support: WebuiTerminalSupport;
  /** The sentence the panel shows while a terminal cannot be opened, or undefined. */
  readonly availability: string | undefined;
}

export function useWorkspaceTerminal({
  owner,
  tabKind,
  tabId,
  workspaceDir,
}: UseWorkspaceTerminalOptions): WorkspaceTerminal {
  const active = tabKind === "terminal";
  const { dom } = useWebuiBrowserCapabilities();
  const [terminals, setTerminalsState] = useState<readonly WebuiTerminalRecord[]>([]);
  /**
   * A terminal list answer is rendered directly (`terminals.find`), so a runtime
   * that answers something else must not reach the render: it becomes an empty
   * list.
   */
  const setTerminals = (answer: unknown): void => {
    setTerminalsState(Array.isArray(answer) ? (answer as readonly WebuiTerminalRecord[]) : []);
  };
  /** Mirror the owner's catalogue into the local render list. */
  const syncTerminalsFromOwner = (current: WebuiTerminalOwner | undefined): void => {
    setTerminals(current?.getSnapshot().terminals ?? []);
  };
  /**
   * Whether the roster has been read at least once for the current workspace.
   *
   * Without it the panel paints an empty terminal list on the first render and
   * then swaps in the real one a moment later. On a reload whose sessions already
   * hold PTYs that reads as "all my terminals exited" and offers a create button
   * that would exceed the limit — a flicker that misreports state, in the one
   * moment the user is deciding whether their shells survived.
   */
  const [terminalsReady, setTerminalsReady] = useState(false);
  /**
   * Monotonic read counter. Each roster read takes the next number and only
   * applies if it is still the newest: switching workspaces quickly starts a
   * second read, and the first one resolving late would otherwise overwrite the
   * newer answer with the previous workspace's terminals.
   */
  const rosterRead = useRef(0);
  const autoCreateTerminalFor = useRef<string>();
  const [terminalInitialSize, setTerminalInitialSize] = useState<{ readonly cols: number; readonly rows: number }>();
  const [terminalError, setTerminalError] = useState<string>();
  const terminalSupport = useSyncExternalStore(
    owner?.subscribe ?? (() => () => undefined),
    () => owner?.support().create ?? "absent",
    () => owner?.support().create ?? "absent",
  );
  const terminalAvailability = terminalSupport === "absent" ? "当前服务未提供终端。"
    : terminalSupport === "not-ready" ? "终端服务尚未就绪。"
      : terminalSupport === "incompatible" ? "终端接口与当前页面不兼容，请检查服务版本。" : undefined;
  // The terminal failed: the failure is said once, as a toast, and is not drawn
  // in the terminal's own status line.
  useWebuiToastError(terminalError, {
    testId: "workspace-terminal-status",
    dataAttributes: { "data-webui-terminal-availability": terminalSupport },
  });
  const terminalHost = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal>();
  const terminalStop = useRef<(() => void) | undefined>();
  /**
   * The size this pane last told the runtime, so an unchanged measurement is
   * not sent twice. Deliberately NOT reset when the effect re-mounts the
   * terminal: the entry carries its terminal id, and a different terminal
   * cannot match it, so a restored PTY still hears about the grid it was fitted
   * to while a newly created PTY can start at its measured grid.
   */
  const reportedTerminalSize = useRef<WebuiTerminalSize>();
  useEffect(() => {
    if (!owner) {
      setTerminals([]);
      setTerminalsReady(true);
      return undefined;
    }
    const read = ++rosterRead.current;
    const stop = owner.subscribe(() => {
      syncTerminalsFromOwner(owner);
      setTerminalError(owner.getSnapshot().error);
    });
    // Not ready until the first answer lands, so a reload holding live PTYs does
    // not paint an empty list and invite a create that would exceed the limit.
    setTerminalsReady(false);
    void owner.refresh().then(() => {
      // A superseded read must not apply: its answer describes a workspace the
      // user has already left.
      if (rosterRead.current !== read) return;
      syncTerminalsFromOwner(owner);
      setTerminalsReady(true);
    });
    return () => {
      stop();
      // Unmounting invalidates this read for the same reason switching does.
      if (rosterRead.current === read) rosterRead.current += 1;
    };
  }, [owner, tabId, workspaceDir, tabKind]);
  const activeTerminal = tabId ? terminals.find((entry) => entry.workspaceTabId === tabId) : undefined;
  const terminalTargetId = activeTerminal?.terminalId;
  useEffect(() => {
    if (!active || !terminalsReady || terminalTargetId || !workspaceDir || !tabId || !owner?.canCreate || !terminalInitialSize) return;
    const autoCreateKey = `${tabId}\0${workspaceDir}`;
    if (autoCreateTerminalFor.current === autoCreateKey) return;
    autoCreateTerminalFor.current = autoCreateKey;
    void owner.create(workspaceDir, terminalInitialSize, tabId).then((created) => {
      if (created) reportedTerminalSize.current = { terminalId: created.terminalId, ...terminalInitialSize };
      syncTerminalsFromOwner(owner);
    }).catch((error: unknown) => setTerminalError(error instanceof Error ? error.message : String(error)));
  }, [tabKind, terminalsReady, terminalTargetId, workspaceDir, owner, terminalInitialSize, tabId]);
  // A view going away releases its watch and its xterm; it never kills a PTY.
  // Process death is the panel's explicit dispose button or the application's
  // disposal.
  useEffect(() => () => { terminalStop.current?.(); terminalInstance.current?.dispose(); }, []);
  // Measure the real xterm grid before creating the PTY. This avoids starting
  // the shell at 80x24 and immediately resizing it, which leaves wrapped prompt
  // fragments behind in some interactive shells.
  useEffect(() => {
    if (!active || terminalTargetId || !terminalHost.current) return;
    const host = terminalHost.current;
    const styles = getComputedStyle(host);
    const terminal = new Terminal({ cols: terminalInitialSize?.cols ?? 80, rows: terminalInitialSize?.rows ?? 24, convertEol: true, theme: { background: styles.getPropertyValue("--bg_default_primary").trim(), foreground: styles.getPropertyValue("--terminal_foreground").trim(), cursor: styles.getPropertyValue("--terminal_cursor").trim() } });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    let disposed = false;
    let initialFitFrame: number | undefined;
    // The grid is measured once the fonts have landed: a measurement taken
    // against fallback glyphs is a measurement of the wrong grid. The wait
    // comes from the browser platform, because a panel that reached for
    // `document` itself would be a panel that could only be placed against a
    // browser.
    void dom.whenFontsReady().then(() => {
      if (disposed) return;
      initialFitFrame = requestAnimationFrame(() => {
        if (disposed) return;
        fit.fit();
        setTerminalInitialSize({ cols: terminal.cols, rows: terminal.rows });
      });
    });
    return () => {
      disposed = true;
      if (initialFitFrame !== undefined) cancelAnimationFrame(initialFitFrame);
      terminal.dispose();
    };
  }, [tabKind, terminalTargetId]);
  useEffect(() => {
    if (!terminalTargetId || !terminalHost.current) return;
    const terminalId = String(terminalTargetId);
    const styles = getComputedStyle(terminalHost.current);
    const terminal = new Terminal({ cols: terminalInitialSize?.cols ?? 80, rows: terminalInitialSize?.rows ?? 24, convertEol: true, theme: { background: styles.getPropertyValue("--bg_default_primary").trim(), foreground: styles.getPropertyValue("--terminal_foreground").trim(), cursor: styles.getPropertyValue("--terminal_cursor").trim() } });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(terminalHost.current);
    terminalInstance.current = terminal;
    terminalStop.current = owner?.attach(terminalId, (frame) => { terminal.write(frame.data); if (frame.exited) terminal.options.disableStdin = true; });
    // The fit moves the browser's viewport; this is what tells the runtime. The
    // size is read at send time, so a drag that ends in one place reports that
    // place once instead of replaying every frame of the drag.
    const reportTerminalSize = () => {
      const request = terminalResizeRequest({ terminalId, cols: terminal.cols, rows: terminal.rows, reported: reportedTerminalSize.current });
      if (!request) return;
      reportedTerminalSize.current = request;
      if (owner?.canResize) void owner.resize(request);
    };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      fit.fit();
      if (!owner?.canResize) return;
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(reportTerminalSize, TERMINAL_RESIZE_DEBOUNCE_MS);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(terminalHost.current);
    const input = terminal.onData((data) => { if (owner?.canWrite) void owner.write(terminalId, data); });
    let disposed = false;
    let initialFitFrame: number | undefined;
    void dom.whenFontsReady().then(() => {
      if (disposed) return;
      initialFitFrame = requestAnimationFrame(() => {
        if (disposed) return;
        fit.fit();
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        reportTerminalSize();
        terminal.focus();
      });
    });
    return () => { disposed = true; if (initialFitFrame !== undefined) cancelAnimationFrame(initialFitFrame); input.dispose(); observer.disconnect(); if (resizeTimer !== undefined) clearTimeout(resizeTimer); terminalStop.current?.(); terminalStop.current = undefined; terminal.dispose(); terminalInstance.current = undefined; };
    // `owner` takes its place beside its neighbours rather than being read
    // through a ref: the owner is created once per mount by the binding and its
    // commands are stable, so a panel drag cannot re-run this effect and rebuild
    // a shell that is running.
  }, [terminalTargetId, owner, tabKind, terminalInitialSize]);
  return {
    hostRef: terminalHost,
    ready: terminalsReady,
    hasTerminal: terminalTargetId !== undefined,
    support: terminalSupport,
    availability: terminalAvailability,
  };
}
