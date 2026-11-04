// The composer toolbar's submission controls: the goal/plan mode pills and the
// send-or-stop button.
//
// They are two components in one module rather than one component, because the
// toolbar places them apart: the pills sit beside the permission control, the
// button last. What they share is the vocabulary — which submission state the
// composer is in and what the control may raise — so they are defined together
// instead of being split across two files that would each restate it.
//
// Both read only the values they display and raise named intents, so the
// composer keeps the mode and submission logic.

import {
  WebuiIconClose,
  WebuiIconCommandGoal,
  WebuiIconCommandPlan,
  WebuiIconSend,
} from "../../../shell/icons.js";
import { WebuiButton } from "../../../ui/button.js";

export interface WebuiComposerModePillsProps {
  /** Whether goal mode is running with a goal the coordinator can create. */
  readonly goalActive: boolean;
  readonly goalSubmitting: boolean;
  readonly planActive: boolean;
  /** A questionnaire or a pending permission blocks both pills. */
  readonly interactionBlocked: boolean;
  readonly onCancelGoal: () => void;
  readonly onCancelPlan: () => void;
}

export function WebuiComposerModePills({
  goalActive,
  goalSubmitting,
  planActive,
  interactionBlocked,
  onCancelGoal,
  onCancelPlan,
}: WebuiComposerModePillsProps) {
  return (
    <>
      {goalActive ? (
        <WebuiButton
          variant="accent-toggle"
          size="inline"
          aria-pressed={true}
          aria-label="取消目标模式"
          data-testid="composer-goal-mode"
          className="webui-composer-mode-pill"
          disabled={goalSubmitting || interactionBlocked}
          onClick={onCancelGoal}
        >
          {/* The mode's own mark at rest, the close mark while the pill is
              hovered or focused: leaving the mode is the pill's only action.
              Both share one box, so the label does not shift. */}
          <span className="webui-composer-mode-pill-glyph">
            <WebuiIconCommandGoal className="webui-composer-mode-pill-mark" />
            <WebuiIconClose className="webui-composer-mode-pill-close" />
          </span>
          <span>目标</span>
        </WebuiButton>
      ) : null}
      {planActive ? (
        <WebuiButton
          variant="accent-toggle"
          size="inline"
          type="button"
          aria-pressed="true"
          aria-label="退出计划模式"
          data-testid="composer-plan-mode"
          className="webui-composer-mode-pill"
          disabled={interactionBlocked}
          onClick={onCancelPlan}
        >
          {/* Same rule as the goal pill: mode mark at rest, close mark on hover
              or focus, one box so the label never moves. */}
          <span className="webui-composer-mode-pill-glyph">
            <WebuiIconCommandPlan className="webui-composer-mode-pill-mark" />
            <WebuiIconClose className="webui-composer-mode-pill-close" />
          </span>
          <span>计划</span>
        </WebuiButton>
      ) : null}
    </>
  );
}

export interface WebuiComposerSubmitButtonProps {
  readonly sending: boolean;
  readonly submitBlocked: boolean;
  readonly onStop: () => void;
}

export function WebuiComposerSubmitButton({
  sending,
  submitBlocked,
  onStop,
}: WebuiComposerSubmitButtonProps) {
  return sending ? (
    <WebuiButton
      variant="send-action"
      size="composer-action"
      aria-label="停止"
      data-webui-composer-stop="true"
      onClick={onStop}
    >
      <span className="webui-send-stop-square" aria-hidden="true" />
    </WebuiButton>
  ) : (
    <WebuiButton
      variant="send-action"
      size="composer-action"
      type="submit"
      disabled={submitBlocked}
      data-testid="composer-send"
      aria-label="发送"
      data-webui-composer-submit="true"
    >
      <WebuiIconSend />
    </WebuiButton>
  );
}
