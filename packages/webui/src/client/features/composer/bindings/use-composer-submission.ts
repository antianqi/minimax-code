/**
 * The composer's two outbound requests: the ordinary submit and the retry of a
 * refused turn.
 *
 * The component used to hold both closures, each rebuilding the wire intent by
 * hand and each interpreting the controller's outcome in place — which kinds
 * clear the history cursor, which one needs a session first, which one settles
 * a goal edit. That is one responsibility: turn the composer's current input
 * into an intent, hand it to the owner, and act on what came back. The assembly
 * rules themselves are `projection/submit-intent.ts`, so they are tested
 * without React; this binding is the wiring, and the component is the form that
 * calls `submit` and the button that calls `retryRefusedTurn`.
 *
 * Nothing about the owner moved: the controller still decides send versus
 * queue, still creates a session when there is none, and still owns the draft
 * consumption that a submission entitles it to.
 */
import type { FormEvent, RefObject } from "react";

import type {
  WebuiComposerController,
} from "../contracts/composer-controller.js";
import type { WebuiSlashCommandFields } from "../contracts/slash-command.js";
import type { WebuiRecordedTurn } from "../contracts/composer-turn.js";
import type { WebuiModelSelectionRequest } from "../../models/contracts/model-view.js";
import type { WebuiAttachmentInput } from "../../../../shared/contracts/messages.js";
import { buildWebuiComposerSubmitIntent } from "../projection/submit-intent.js";

export interface UseComposerSubmissionOptions {
  readonly controller: WebuiComposerController;
  readonly sessionId: string | undefined;
  /** The text on the wire: trimmed draft plus URL references. */
  readonly messageDraft: string;
  /** The palette entry the typed slash token resolved to, if any. */
  readonly commandMatch?: WebuiSlashCommandFields;
  /** The body typed after a runnable command, if any. */
  readonly commandInvocationInput?: string;
  readonly attachments: readonly WebuiAttachmentInput[];
  readonly sending: boolean;
  readonly planMode: boolean;
  readonly goalEnabled: boolean;
  readonly agentName: string;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff: boolean;
  /** A model picked on home, applied to whichever session the submit creates. */
  readonly pendingHomeModelSelection: RefObject<WebuiModelSelectionRequest | undefined>;
  /** Applies a model to a created session; rejects on failure. */
  readonly prepareModelSelection?: (request: WebuiModelSelectionRequest, createdSessionId: string) => Promise<void>;
  /** The live refusal, for the retry record. */
  readonly refusal: string | undefined;
  /** The last submitted turn, as the retry record kept it. */
  readonly recordedTurn: WebuiRecordedTurn | undefined;
  /** Whether this view still owns the session the request was captured under. */
  readonly isAttachedTo: (sessionId: string | undefined) => boolean;
  readonly onSessionCreated?: (sessionId: string, selected: boolean, teamModeOff: boolean) => void;
  readonly onNeedsSession?: (draft: string) => void;
  /** The submission reset the history cursor. */
  readonly onHistoryReset: () => void;
  /** A goal submission settled the goal edit. */
  readonly onGoalSettled: () => void;
  /** The composer's one error slot. */
  readonly reportError: (message: string | undefined) => void;
}

export interface ComposerSubmission {
  readonly submit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  /** Re-sends the recorded turn. The affordance only exists when it can work. */
  readonly retryRefusedTurn: () => void;
}

export function useComposerSubmission({
  controller,
  sessionId,
  messageDraft,
  commandMatch,
  commandInvocationInput,
  attachments,
  sending,
  planMode,
  goalEnabled,
  agentName,
  createSessionWorkspaceDir,
  teamModeOff,
  pendingHomeModelSelection,
  prepareModelSelection,
  refusal,
  recordedTurn,
  isAttachedTo,
  onSessionCreated,
  onNeedsSession,
  onHistoryReset,
  onGoalSettled,
  reportError,
}: UseComposerSubmissionOptions): ComposerSubmission {
  const onCreated = (createdSessionId: string, selected: boolean) => {
    if (isAttachedTo(sessionId)) onSessionCreated?.(createdSessionId, selected, teamModeOff);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Pure intent resolution — five paths: activate-goal-mode, submit-goal,
    // run-command, submit-turn (which the owner further splits into send+resume
    // versus queue). The side effects below stay here so the resolver itself is
    // testable without React.
    reportError(undefined);
    const pendingHomeSelection = sessionId
      ? undefined
      : pendingHomeModelSelection.current;
    const outcome = await controller.submit(buildWebuiComposerSubmitIntent({
      draft: messageDraft,
      ...(commandMatch ? { commandMatch } : {}),
      ...(commandInvocationInput !== undefined ? { commandInvocationInput } : {}),
      attachments,
      sending,
      planMode,
      goalEnabled,
      agentName,
      ...(createSessionWorkspaceDir ? { createSessionWorkspaceDir } : {}),
      teamModeOff,
      ...(pendingHomeSelection ? { pendingHomeModelSelection: pendingHomeSelection } : {}),
      ...(prepareModelSelection ? { prepareModelSelection } : {}),
      reportError,
      onSessionCreated: onCreated,
    }));
    if (outcome.kind !== "ignored" && outcome.kind !== "mode-activated") onHistoryReset();
    if (outcome.kind === "needs-session" && isAttachedTo(sessionId)) onNeedsSession?.(outcome.draft);
    if (outcome.kind === "goal-updated") onGoalSettled();
  };
  const retryRefusedTurn = () => {
    void controller.retry({
      ...buildWebuiComposerSubmitIntent({
        draft: recordedTurn?.message ?? "",
        attachments,
        sending,
        planMode,
        goalEnabled,
        agentName,
        ...(createSessionWorkspaceDir ? { createSessionWorkspaceDir } : {}),
        teamModeOff,
        onSessionCreated: onCreated,
      }),
      refusal,
      sessionId,
    });
  };
  return { submit, retryRefusedTurn };
}
