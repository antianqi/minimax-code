// React subscription to a session's snapshot.
//
// The store and its writer live in `client/application/session-store.ts`; this
// hook only *reads* the store's snapshot and narrows it with the application
// selectors. No second map is created here — the hook holds no state of its own
// beyond what `useSyncExternalStore` needs to schedule a
// render when the application notifies.
//
// The interaction commands are built here too, bound to the store's interaction
// writer for the owner key, so the composer submits `applyGoal` /
// `replacePendingPermissions` and holds no writer for that state.
//
// The turn commands are not built here. `useWebuiSessionCommands` reads the
// application's one conversation command set — the same construction the event
// coordinator's attach/recheck routes and the composer's submissions use — and
// the capabilities those commands run on are the application's published turn
// capability slice (`features/turn/application/turn-capabilities.ts`), cut from
// the port the composition root holds. A host with nothing wired has no slice
// member for the operation, and the loop's own absent-capability guard refuses
// the turn with a stated reason.

import { useCallback, useMemo } from "react";

import {
  selectWebuiSession,
} from "../application/selectors.js";
import type { WebuiGoal } from "../../shared/contracts/goal.js";
import type {
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
} from "../../shared/contracts/interactions.js";
import type { WebuiApplicationSessionState, WebuiApplicationState } from "../application/state.js";
import { initialWebuiApplicationSessionState } from "../application/state.js";
import type { WebuiStreamState } from "../features/turn/projection/stream-state.js";
import {
  createWebuiInteractionCommands,
  type WebuiInteractionCommands,
} from "../features/sessions/application/session-commands.js";
import type { WebuiConversationTurnCommands } from "../features/turn/contracts/turn-commands.js";
import {
  useWebuiApplicationOptional,
  useWebuiSessionStoreContext,
  useWebuiSessionStoreSelection,
} from "./application-context.js";

export function useWebuiTranscriptHistoryOwner() {
  const owner = useWebuiApplicationOptional()?.transcriptHistory;
  return useMemo(() => owner ? {
    seed: owner.seed, loadPage: owner.loadPage, loadOlder: owner.loadOlder, isCurrentPage: owner.isCurrentPage,
  } : undefined, [owner]);
}

export function useWebuiTranscriptSettlementOwner() {
  const owner = useWebuiApplicationOptional()?.transcriptSettlement;
  return useMemo(() => owner ? { retry: owner.retry } : undefined, [owner]);
}

function useSessionSlice<T>(sessionId: string | undefined, select: (session: WebuiApplicationSessionState) => T): T {
  return useWebuiSessionStoreSelection(useCallback(
    (snapshot: WebuiApplicationState) => select(
      (sessionId ? selectWebuiSession(snapshot, sessionId) : undefined) ?? initialWebuiApplicationSessionState,
    ),
    [sessionId, select],
  ));
}

const sessionSlice = (session: WebuiApplicationSessionState) => session;
const streamSlice = (session: WebuiApplicationSessionState) => session.stream;
const permissionsSlice = (session: WebuiApplicationSessionState) => session.permissions;
const questionnaireSlice = (session: WebuiApplicationSessionState) => session.questionnaire;
const goalSlice = (session: WebuiApplicationSessionState) => session.goal;
const transcriptSlice = (session: WebuiApplicationSessionState) => session.transcript;
const queueSendsSlice = (session: WebuiApplicationSessionState) => session.transcript.queueSends;
const transcriptPageSlice = (session: WebuiApplicationSessionState) => session.transcript.page;
const sendingSlice = (session: WebuiApplicationSessionState) => session.sending;
const refusalSlice = (session: WebuiApplicationSessionState) => session.stream.refusal;
const incompleteSlice = (session: WebuiApplicationSessionState) => session.stream.transcriptIncomplete;
const contextUsageSlice = (session: WebuiApplicationSessionState) => session.stream.contextUsage ?? session.stream.messages.at(-1)?.contextUsage;

export function useWebuiSessionState(
  sessionId: string | undefined,
): WebuiApplicationSessionState {
  return useSessionSlice(sessionId, sessionSlice);
}

export function useWebuiSessionStream(
  sessionId: string | undefined,
): WebuiStreamState {
  return useSessionSlice(sessionId, streamSlice);
}

/** The session's pending permissions, read through the selector. */
export function useWebuiSessionPermissions(
  sessionId: string | undefined,
): readonly WebuiPendingPermission[] {
  return useSessionSlice(sessionId, permissionsSlice);
}

/** The session's pending questionnaire, read through the selector. */
export function useWebuiSessionQuestionnaire(
  sessionId: string | undefined,
): WebuiQuestionnaireRequest | undefined {
  return useSessionSlice(sessionId, questionnaireSlice);
}

/** The session's goal, read through the selector. */
export function useWebuiSessionGoal(
  sessionId: string | undefined,
): WebuiGoal | undefined {
  return useSessionSlice(sessionId, goalSlice);
}

export function useWebuiSessionTranscript(sessionId: string): WebuiApplicationSessionState["transcript"] {
  return useSessionSlice(sessionId, transcriptSlice);
}

export function useWebuiSessionQueueSends(sessionId: string | undefined) {
  return useSessionSlice(sessionId, queueSendsSlice);
}

export function useWebuiSessionTranscriptPage(sessionId: string | undefined) {
  return useSessionSlice(sessionId, transcriptPageSlice);
}

export function useWebuiSessionSending(sessionId: string | undefined) {
  return useSessionSlice(sessionId, sendingSlice);
}

export function useWebuiSessionRefusal(sessionId: string | undefined) {
  return useSessionSlice(sessionId, refusalSlice);
}

export function useWebuiSessionTranscriptIncomplete(sessionId: string | undefined) {
  return useSessionSlice(sessionId, incompleteSlice);
}

export function useWebuiSessionContextUsage(sessionId: string | undefined) {
  return useSessionSlice(sessionId, contextUsageSlice);
}

/**
 * The interaction command surface for one session (or the home slot). The
 * component calls `replacePendingPermissions` / `removePendingPermission` /
 * `applyQuestionnaire` / `applyGoal` through this, never a store setter; the
 * interaction writer stays inside the binding and is rebuilt only when the
 * owner key changes.
 */
export function useWebuiInteractionCommands(
  sessionId: string | undefined,
): WebuiInteractionCommands {
  const store = useWebuiSessionStoreContext();
  return useMemo(
    () =>
      createWebuiInteractionCommands(
        store.createInteractionWriter(
          sessionId
            ? { kind: "session", sessionId }
            : { kind: "home" },
        ),
      ),
    [store, sessionId],
  );
}

/**
 * The conversation command set for one session (or the home slot), read from the
 * application.
 *
 * A binding used to choose the record key, build the store writer, mint the
 * attempt's sink, cut the transports out of the capability slice and assemble the
 * two view objects — five decisions about application state, made in a React hook,
 * and a second construction of what the application's own routes already drive.
 * It reads the application's one owner, so a component invokes a command and
 * receives no writer, no sink factory and no capability.
 *
 * `undefined` means this host has no application at all (SSR, a store-only
 * render), so there is no execution owner to invoke. That is the honest answer:
 * a second owner built here to keep a fixture working would be exactly the
 * duplicate construction this hook removes.
 */
export function useWebuiSessionCommands(
  sessionId: string | undefined,
): WebuiConversationTurnCommands | undefined {
  const application = useWebuiApplicationOptional();
  return useMemo(
    () => application?.turnCommandsFor(sessionId),
    [application, sessionId],
  );
}
