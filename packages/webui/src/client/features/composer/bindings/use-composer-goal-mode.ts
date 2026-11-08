/**
 * The composer's goal and plan input modes.
 *
 * Entering a mode changes three things at once and the component held all three
 * paths: the two mode flags (which are the composer owner's), the draft (which
 * is the shell's) and the caret (which is the textarea's). Around them sat two
 * more rules — whether this runtime can hold a goal at all, read once per
 * session, and what a goal's own re-read means for the mode — plus the one
 * piece of state that is neither: whether the draft in the box came from
 * `onEditGoal`, which decides whether leaving goal mode may clear it.
 *
 * That is the responsibility here. What the composer keeps is the trigger
 * (`/goal`, the `+` menu's row, the banner's edit button) and the panels it
 * draws while a mode is active.
 *
 * Behaviour is unchanged: entering goal mode requires a runtime that can create
 * goals and is enabled; the two modes are exclusive; cancelling a goal clears
 * the draft only when it was an edit or there is no goal; plan mode always
 * clears the draft it was entered from.
 */
import { useEffect, useRef, useState, type RefObject } from "react";

import type { WebuiGoal } from "../../../../shared/contracts/goal.js";
import {
  useWebuiGoalOwner,
  useWebuiGoalReaction,
} from "../../goal/bindings/goal-owner.public.js";

/**
 * The two capabilities this flow uses, read off the goal business's published
 * owner rather than its application module: the enable probe and the create
 * affordance, and nothing else of the owner.
 */
type ComposerGoalOwner = Pick<ReturnType<typeof useWebuiGoalOwner>, "isGoalEnabled" | "createGoal">;

export interface UseComposerGoalModeOptions {
  readonly sessionId: string | undefined;
  /** The session's goal, as the application store holds it. */
  readonly goal: WebuiGoal | undefined;
  /** The session's goal owner: the enable probe and the create affordance. */
  readonly goalCoordinator: ComposerGoalOwner;
  readonly goalMode: boolean;
  readonly planMode: boolean;
  readonly setGoalMode: (enabled: boolean) => void;
  readonly setPlanMode: (enabled: boolean) => void;
  readonly onDraftChange: (next: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement>;
}

export interface ComposerGoalMode {
  /** This runtime can hold a goal; false after a probe that said no. */
  readonly goalEnabled: boolean;
  /** The goal pill is showing: enabled, creatable and in goal mode. */
  readonly goalActive: boolean;
  readonly activateGoalMode: () => void;
  readonly activatePlanMode: () => void;
  readonly editGoalInComposer: (objective: string) => void;
  readonly cancelGoalMode: () => void;
  readonly cancelPlanMode: () => void;
  /** A submission updated the goal, so the draft is no longer an edit of it. */
  readonly settleGoalEdit: () => void;
}

export function useComposerGoalMode({
  sessionId,
  goal,
  goalCoordinator,
  goalMode,
  planMode,
  setGoalMode,
  setPlanMode,
  onDraftChange,
  textareaRef,
}: UseComposerGoalModeOptions): ComposerGoalMode {
  const [goalEnabled, setGoalEnabled] = useState(true);
  // Whether the draft came from the banner's edit affordance. Only then may
  // leaving goal mode clear it.
  const editingGoalDraftRef = useRef(false);

  /**
   * The view's half of a steering re-read: after one lands, the composer's goal
   * mode follows the goal it returned. Keyed by the session whose goal it
   * describes.
   */
  useWebuiGoalReaction(sessionId, (next) => {
    if (next) setGoalMode(next.status !== "complete");
  });

  const goalEnabledProbe = goalCoordinator.isGoalEnabled;
  useEffect(() => {
    if (!goalEnabledProbe) {
      setGoalEnabled(true);
      return undefined;
    }
    let cancelled = false;
    void goalEnabledProbe()
      .then((result) => {
        if (cancelled) return;
        setGoalEnabled(result.enabled);
        if (!result.enabled) setGoalMode(false);
      })
      .catch(() => { if (!cancelled) setGoalEnabled(false); });
    return () => {
      cancelled = true;
    };
  }, [goalEnabledProbe]);

  const activateGoalMode = () => {
    if (!goalEnabled || !goalCoordinator.createGoal) return;
    setGoalMode(true);
    setPlanMode(false);
    onDraftChange("");
    textareaRef.current?.focus();
  };
  const activatePlanMode = () => {
    setPlanMode(true);
    setGoalMode(false);
    onDraftChange("");
    textareaRef.current?.focus();
  };
  const editGoalInComposer = (objective: string) => {
    editingGoalDraftRef.current = true;
    setGoalMode(true);
    setPlanMode(false);
    onDraftChange(objective);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(objective.length, objective.length);
    });
  };
  const cancelGoalMode = () => {
    setGoalMode(false);
    if (!goal || editingGoalDraftRef.current) onDraftChange("");
    editingGoalDraftRef.current = false;
    textareaRef.current?.focus();
  };
  const cancelPlanMode = () => {
    setPlanMode(false);
    onDraftChange("");
    textareaRef.current?.focus();
  };
  const settleGoalEdit = () => {
    editingGoalDraftRef.current = false;
  };

  return {
    goalEnabled,
    goalActive: goalEnabled && goalCoordinator.createGoal !== undefined && goalMode,
    activateGoalMode,
    activatePlanMode,
    editGoalInComposer,
    cancelGoalMode,
    cancelPlanMode,
    settleGoalEdit,
  };
}
