/**
 * The composer's outbound turn request, assembled in one place.
 *
 * The component used to build this object inline, twice: once in `submit`, once
 * in the retry path, one of them with a created-session hook and one without.
 * Every conditional field was a spread chosen at the call site, so "which
 * fields travel on the wire" could only be read by following two closures
 * through a JSX render. It is a projection: pure input in, the controller's
 * submit intent out, testable without React.
 *
 * The rules it holds, stated:
 *
 *   - The workspace and the team choice travel only when they are asked for.
 *     An absent one is an absent field, not `undefined` on the wire.
 *   - A command invocation's argument travel only when the invocation carried
 *     a body; `/plan` alone has none.
 *   - A model selected on home travels as `prepareCreatedSession`: the model is
 *     applied to the session the submission creates, and a failure there is
 *     reported and re-thrown so the submission stops rather than sending with
 *     the wrong model.
 */

import type { WebuiComposerSubmitIntent } from "../contracts/composer-controller.js";
import type { WebuiModelSelectionRequest } from "../../models/contracts/model-view.js";
import type { WebuiSlashCommandFields } from "../contracts/slash-command.js";
import type { WebuiAttachmentInput } from "../../../../shared/contracts/messages.js";

export interface BuildWebuiComposerSubmitIntentInput {
  /** The text on the wire: the trimmed draft plus the URL references. */
  readonly draft: string;
  /** The palette entry the typed slash token resolved to, when there is one. */
  readonly commandMatch?: WebuiSlashCommandFields;
  /** The body typed after a runnable command, when there is one. */
  readonly commandInvocationInput?: string;
  readonly attachments: readonly WebuiAttachmentInput[];
  readonly sending: boolean;
  readonly planMode: boolean;
  readonly goalEnabled: boolean;
  readonly agentName: string;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff: boolean;
  /** A model picked while the composer had no session yet. */
  readonly pendingHomeModelSelection?: WebuiModelSelectionRequest;
  /** Applies a model to the session a submission created; rejects on failure. */
  readonly prepareModelSelection?: (request: WebuiModelSelectionRequest, createdSessionId: string) => Promise<void>;
  /** Where a failed model selection is reported before it is re-thrown. */
  readonly reportError?: (message: string) => void;
  readonly onSessionCreated?: (sessionId: string, selected: boolean) => void;
}

export function buildWebuiComposerSubmitIntent({
  draft,
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
  reportError,
  onSessionCreated,
}: BuildWebuiComposerSubmitIntentInput): WebuiComposerSubmitIntent {
  return {
    draft,
    ...(commandMatch ? { commandMatch } : {}),
    ...(commandInvocationInput !== undefined ? { commandInvocationInput } : {}),
    attachments,
    sending,
    planMode,
    goalEnabled,
    agentName,
    ...(createSessionWorkspaceDir ? { createSessionWorkspaceDir } : {}),
    ...(teamModeOff ? { teamModeOff: true } : {}),
    ...(pendingHomeModelSelection && prepareModelSelection
      ? {
          prepareCreatedSession: async (createdSessionId: string) => {
            try {
              await prepareModelSelection(pendingHomeModelSelection, createdSessionId);
            } catch (error) {
              reportError?.(error instanceof Error ? error.message : String(error));
              throw error;
            }
          },
        }
      : {}),
    ...(onSessionCreated ? { onSessionCreated } : {}),
  };
}
