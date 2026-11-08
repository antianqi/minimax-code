/**
 * The composer's permission-mode flow, as one binding.
 *
 * Two responsibilities had their halves in different places and both halves in
 * the component: reading the mode (a load effect that also decided what
 * "unavailable" means and which payloads count as this request's error) and
 * writing it (a handler that closed the menu first, held a busy flag, compared
 * the runtime's answer with what was asked for, and wrote the same error slot).
 * The popover's open state sat between them.
 *
 * What the component keeps is what it renders: the control, the click that also
 * dismisses its other surfaces, and the mode that control shows. What it no
 * longer knows is how the settings owner answers, which outcome statuses exist,
 * or why a write that settled on another mode is a failure.
 *
 * Behaviour is unchanged, including the cases with no owner: a load that was
 * superseded or disposed reports nothing rather than clearing the mode, and a
 * write the owner says it cannot perform is not attempted.
 */
import { useCallback, useEffect, useState } from "react";

import {
  useWebuiSettingsWorkflows,
  useWebuiSettingsWorkflowsState,
} from "../../../bindings/use-query-state.js";
import type { WebuiPermissionMode } from "../../settings/contracts/settings-port.js";

export interface UseComposerPermissionModeOptions {
  /** The composer's one error slot: a failed read or write is said through it. */
  readonly reportError: (message: string | undefined) => void;
}

export interface ComposerPermissionMode {
  /** The live mode; `undefined` while the settings read has not answered. */
  readonly mode: WebuiPermissionMode | undefined;
  readonly menuOpen: boolean;
  readonly busy: boolean;
  readonly unavailable: boolean;
  /** The menu's open state, for the composer's keyboard and pointer handlers. */
  readonly setMenuOpen: (open: boolean) => void;
  readonly toggleMenu: () => void;
  readonly closeMenu: () => void;
  readonly changeMode: (mode: WebuiPermissionMode) => Promise<void>;
}

export function useComposerPermissionMode({
  reportError,
}: UseComposerPermissionModeOptions): ComposerPermissionMode {
  const settingsWorkflows = useWebuiSettingsWorkflows();
  const settingsSnapshot = useWebuiSettingsWorkflowsState();
  const mode = settingsSnapshot.permissionMode.value;
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!settingsWorkflows) return undefined;
    if (!settingsWorkflows.canReadPermissionMode) {
      setUnavailable(true);
      return undefined;
    }
    // The owner reports what this request produced, so the surface does not
    // re-read the shared snapshot to find out what it just got — and an
    // unsupported payload is this request's error rather than a field that may
    // have been overwritten by a later read.
    settingsWorkflows
      .loadPermissionMode()
      .then((outcome) => {
        if (cancelled) return;
        if (outcome.status === "ready") {
          setUnavailable(false);
          return;
        }
        setUnavailable(true);
        if (outcome.status === "failed") {
          reportError(
            outcome.error instanceof Error ? outcome.error.message : "加载授权模式失败",
          );
          return;
        }
        // Superseded or disposed: this request was refused, so there is nothing
        // to report — the control keeps whatever the snapshot already holds.
        setUnavailable(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUnavailable(true);
        reportError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [settingsWorkflows]);

  const toggleMenu = useCallback(() => setMenuOpen((open) => !open), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const changeMode = useCallback(async (next: WebuiPermissionMode) => {
    if (!settingsWorkflows?.canWritePermissionMode) return;
    // Close the menu at the point of selection. The write may take a moment,
    // but the selected row should never remain visible in a disabled/greyed
    // state while the runtime is saving it.
    setMenuOpen(false);
    setBusy(true);
    reportError(undefined);
    try {
      // The owner writes and answers with the mode the runtime settled on, so a
      // runtime that accepted something else is caught here.
      const refreshed = await settingsWorkflows.savePermissionMode(next);
      if (refreshed !== next) throw new Error("授权模式未能保存，请重试");
      setUnavailable(false);
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [settingsWorkflows, reportError]);

  return { mode, menuOpen, busy, unavailable, setMenuOpen, toggleMenu, closeMenu, changeMode };
}
