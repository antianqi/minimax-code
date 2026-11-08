// The transcript's view model: the transcript owns grouping and view projection.
//
// Everything here is a pure function of the page, the live stream and the stream
// phase. It used to be eleven `useMemo` blocks inside the component, which made
// the component's job — render — indistinguishable from the derivation it
// renders. The component now calls this once and destructures the result.
//
// Two of the derivations are subtle enough to keep their reasons in one place:
//
// - `liveGroupViews` projects each group's live view from that group's OWN
//   messages. A goal run injects a synthetic user continuation between model
//   calls, and a user item opens a new group, so one live turn can own several
//   assistant groups; broadcasting the turn-wide live view into every one of them
//   duplicated the streamed content across the transcript and stranded a second
//   activity pulse mid-thread.
// - `trailingLiveGroupId` decides which group owns the live activity row, so the
//   `推理中…` indicator renders exactly once and always trails the transcript.

import type { WebuiClientMessage, WebuiClientMessagePage, WebuiQueueSend } from "../contracts/message-view.js";
import { isTurnLive } from "../../turn/contracts/stream-state.js";
import { projectWebuiTranscriptMessage } from "./message-projection.js";
import {
  groupWebuiTranscriptItems,
  projectWebuiQueryDurations,
  projectWebuiTranscriptMessages,
  projectWebuiProcessSegments,
} from "./transcript-projection.js";
import type { WebuiTranscriptItem } from "../contracts/transcript-view.js";
import type { WebuiTurnView } from "./transcript-shape.js";

type WebuiTranscriptStreamMessages = Parameters<typeof projectWebuiTranscriptMessages>[1];
type WebuiTranscriptStreamPhase = Parameters<typeof isTurnLive>[0];
type WebuiTranscriptMessageProjection = ReturnType<typeof projectWebuiTranscriptMessage>;
type WebuiTranscriptGroup = ReturnType<typeof groupWebuiTranscriptItems>[number];

// Historical page messages are immutable snapshots. While the active stream
// changes, their identity stays stable, so keep their expensive parts and view
// projections instead of rebuilding them on every stream frame.
const messageProjectionCache = new WeakMap<WebuiClientMessage, WebuiTranscriptMessageProjection>();
const queueMessageCache = new WeakMap<WebuiQueueSend, WebuiClientMessage>();
const queueRenderCache = new WeakMap<WebuiTranscriptRenderGroup, { readonly entry: WebuiQueueSend; readonly pending: boolean; readonly result: WebuiTranscriptRenderGroup }>();

function withQueueSend(result: WebuiTranscriptRenderGroup, entry: WebuiQueueSend | undefined, pending: boolean): WebuiTranscriptRenderGroup {
  if (!entry || !result.view) return result;
  const cached = queueRenderCache.get(result);
  if (cached?.entry === entry && cached.pending === pending) return cached.result;
  const projected = { ...result, view: { ...result.view, renderKey: `queue:${entry.itemId}`, ...(pending ? { queueSend: entry } : {}) } };
  queueRenderCache.set(result, { entry, pending, result: projected });
  return projected;
}

function queueMessage(entry: WebuiQueueSend): WebuiClientMessage {
  let message = queueMessageCache.get(entry);
  if (!message) {
    message = { msgId: `queue-intent:${entry.itemId}`, role: "user", msgContent: entry.content,
      actions: { fork: false, rewind: false, edit: false } };
    queueMessageCache.set(entry, message);
  }
  return message;
}

function projectMessage(message: WebuiClientMessage): WebuiTranscriptMessageProjection {
  const cached = messageProjectionCache.get(message);
  if (cached) return cached;
  const projection = projectWebuiTranscriptMessage(message);
  messageProjectionCache.set(message, projection);
  return projection;
}
/** One assistant turn as the right-rail navigator lists it. */
export interface WebuiTranscriptTurnRow {
  readonly id: string;
  readonly state: "active" | "running" | "default";
}

export interface WebuiTranscriptView {
  readonly renderGroups: readonly WebuiTranscriptRenderGroup[];
  readonly messages: ReturnType<typeof projectWebuiTranscriptMessages>;
  readonly groups: readonly WebuiTranscriptGroup[];
  readonly turnLive: boolean;
  readonly showThinking: boolean;
  readonly showAfterQuery: boolean;
  readonly turns: readonly WebuiTranscriptTurnRow[];
  readonly showEmptyState: boolean;
}

export interface WebuiTranscriptRenderGroup {
  readonly group: WebuiTranscriptGroup;
  readonly view?: WebuiTurnView;
  readonly questionnaire?: Extract<WebuiTranscriptItem, { kind: "questionnaire_response" }>;
}

const renderGroupCache = new WeakMap<WebuiTranscriptItem, {
  readonly sessionId: string;
  readonly live: LiveGroup | undefined;
  readonly active: boolean;
  readonly mutationsBlocked: boolean;
  readonly result: WebuiTranscriptRenderGroup;
}>();

interface LiveGroup {
  readonly assistantMessageId: string;
  readonly streaming: boolean;
  readonly processingStartedAtMs: number | undefined;
}

function projectRenderGroup(
  group: WebuiTranscriptGroup,
  sessionId: string,
  live: LiveGroup | undefined,
  liveActivityGroupId: string | undefined,
  mutationsBlocked: boolean,
): WebuiTranscriptRenderGroup {
  const first = group.items[0];
  const cached = first && renderGroupCache.get(first);
  const before = cached?.result.group;
  const active = group.messageId === liveActivityGroupId;
  if (cached && before && cached.mutationsBlocked === mutationsBlocked && cached.sessionId === sessionId && cached.live?.assistantMessageId === live?.assistantMessageId &&
      cached.live?.streaming === live?.streaming && cached.live?.processingStartedAtMs === live?.processingStartedAtMs && cached.active === active &&
      before.messageId === group.messageId && before.turnId === group.turnId &&
      before.totalRequestDurationMs === group.totalRequestDurationMs && before.totalOutputTokens === group.totalOutputTokens &&
      before.wallClockDurationMs === group.wallClockDurationMs && before.forceExpanded === group.forceExpanded &&
      before.items.length === group.items.length && before.items.every((item, index) => item === group.items[index])) return cached.result;
  const result = buildRenderGroup(group, sessionId, live, liveActivityGroupId, mutationsBlocked);
  if (first) renderGroupCache.set(first, { sessionId, live, active, mutationsBlocked, result });
  return result;
}

function buildRenderGroup(
  group: WebuiTranscriptGroup,
  sessionId: string,
  live: LiveGroup | undefined,
  liveActivityGroupId: string | undefined,
  mutationsBlocked: boolean,
): WebuiTranscriptRenderGroup {
  const questionnaire = group.items.find(
    (item): item is Extract<WebuiTranscriptItem, { kind: "questionnaire_response" }> => item.kind === "questionnaire_response",
  );
  const user = group.items.find(
    (item): item is Extract<WebuiTranscriptItem, { text: string }> => item.kind === "user",
  );
  if (user) return { group, questionnaire, view: {
    source: "historical", role: "user", sessionId, messageId: user.messageId,
    userText: user.text, actions: mutationsBlocked && user.actions ? { ...user.actions, rewind: false, edit: false } : user.actions, timestamp: user.timestamp, isGoal: user.isGoal,
  } };
  if (questionnaire) return { group, questionnaire };
  const thoughts = group.items.filter(
    (item): item is Extract<WebuiTranscriptItem, { text: string }> => item.kind === "thinking",
  );
  const answers = group.items.filter(
    (item): item is Extract<WebuiTranscriptItem, { text: string }> => item.kind === "assistant",
  );
  const tools = group.items.flatMap((item) => item.kind === "tool" ? item.tools : []);
  const content = {
    role: "assistant" as const, sessionId, messageId: group.messageId,
    thinking: thoughts.length ? thoughts.map((item) => item.text).join("\n\n") : undefined,
    tools: tools.length ? tools : undefined,
    answers: answers.map((item) => item.text),
    totalRequestDurationMs: group.totalRequestDurationMs,
    totalOutputTokens: group.totalOutputTokens,
    processSegments: projectWebuiProcessSegments(group.items),
  };
  if (live) return { group, view: {
    ...content, source: "live", assistantMessageId: live.assistantMessageId,
    streamMessageId: "merged", messageRootId: "merged",
    processingStartedAtMs: live.processingStartedAtMs,
    streaming: live.streaming && group.messageId === liveActivityGroupId,
  } };
  const actions = group.items.find((item) => "actions" in item && item.actions !== undefined);
  const diff = [...group.items].reverse().find((item) => "diff" in item && item.diff !== undefined);
  return { group, view: {
    ...content, source: "historical",
    ...(group.turnId ? { turnId: group.turnId } : {}),
    ...(group.forceExpanded ? { processForceExpanded: true } : {}),
    thinkingDurationMs: thoughts[0]?.durationMs,
    actions: actions && "actions" in actions ? actions.actions : undefined,
    initialDiff: diff && "diff" in diff ? diff.diff : undefined,
    attachments: answers[0]?.attachments,
  } };
}

export function projectWebuiTranscriptView(input: {
  readonly sessionId: string;
  readonly visiblePage: WebuiClientMessagePage;
  readonly streamMessages: WebuiTranscriptStreamMessages;
  readonly retainedMessages?: WebuiTranscriptStreamMessages;
  readonly queueSends?: readonly WebuiQueueSend[];
  readonly streamPhase: WebuiTranscriptStreamPhase;
  readonly messageSource?: "stream" | "history";
  readonly processingStartedAtMs: number | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
}): WebuiTranscriptView {
  const { sessionId, visiblePage, streamMessages, streamPhase, processingStartedAtMs } = input;
  const turnLive = isTurnLive(streamPhase);
  const current = streamPhase !== "done" ? streamMessages : [];
  const currentIds = new Set(current.map((message) => message.id));
  const retainedById = new Map((input.retainedMessages ?? []).map((message) => [message.id, message]));
  const visibleStreamMessages = input.messageSource === "history"
    ? streamMessages.map((message) => retainedById.get(message.id) ?? message)
    : streamMessages;
  const observedMessages = input.retainedMessages
    ? [
        ...input.retainedMessages.filter((message) => !currentIds.has(message.id)),
        ...current.map((message) => input.messageSource === "history" ? retainedById.get(message.id) ?? message : message),
      ]
    : streamMessages;
  // History and stream frames feed one transcript projection. The live records
  // update the same message identities in this list while history supplies the
  // persisted fields and older messages.
  const observed = projectWebuiTranscriptMessages(
    visiblePage,
    observedMessages,
    input.retainedMessages !== undefined || streamPhase !== "done",
  );
  const queueSends = input.queueSends ?? [];
  const byItemId = new Map(queueSends.map((entry) => [entry.itemId, entry]));
  const observedSources = new Set(queueSends.length ? observed.filter((message) => message.role === "user").map((message) => message.sourceMessageId) : []);
  const pending = queueSends.filter((entry) => entry.phase !== "confirmed" &&
    !observedSources.has(entry.itemId));
  const pendingByMessageId = new Map(pending.map((entry) => [queueMessage(entry).msgId, entry]));
  const acceptedByMessageId = new Map(queueSends.length ? observed.flatMap((message) => {
    const entry = message.role === "user" && message.sourceMessageId ? byItemId.get(message.sourceMessageId) : undefined;
    return entry ? [[message.msgId, entry] as const] : [];
  }) : []);
  const messages = pending.length ? [...observed, ...pending.map(queueMessage)] : observed;
  const messageProjections = messages.map(projectMessage);
  const items = messageProjections.flatMap((projection) => projection.items);
  // Group by message so one turn renders as one block: a process disclosure
  // carrying the thinking and the tool steps, then the assistant's markdown. A
  // user turn is its own block.
  const queryDurationByMessageId = projectWebuiQueryDurations(
    visiblePage.messages ?? [],
    visiblePage.queryCollapseViews ?? [],
  );
  const groups = groupWebuiTranscriptItems(items, queryDurationByMessageId);
  const liveAssistantMessages = streamMessages.filter(
    (message) => message.role !== "user",
  );
  const liveGroupViews = projectLiveGroupViews({
    groups,
    streamMessages: visibleStreamMessages,
    sessionId,
    streamPhase,
    processingStartedAtMs,
    turnLive,
  });
  const trailingLiveGroupId = projectTrailingLiveGroupId(groups, streamMessages);
  // The activity indicator falls back to transcript level when the last live
  // group is the goal continuation BUBBLE rather than an assistant group: no
  // message body is left to host the row, the previous round has settled, and the
  // next model call has not started thinking yet.
  const liveActivityGroupId =
    pending.length === 0 && trailingLiveGroupId && liveGroupViews?.has(trailingLiveGroupId)
      ? trailingLiveGroupId
      : undefined;
  const turns = projectTurnRows(groups, streamPhase);
  const showEmptyState =
    !turnLive && !input.error && !input.loading && items.length === 0;
  const showThinking = turnLive && (streamPhase === "streaming" || streamPhase === "waiting") &&
    (liveAssistantMessages.length === 0 || !liveAssistantMessages.some((message) => message.thinking.trim()) ||
      (trailingLiveGroupId !== undefined && liveActivityGroupId === undefined));
  return {
    renderGroups: groups.map((group) => {
      const result = projectRenderGroup(group, sessionId, liveGroupViews?.get(group.messageId), liveActivityGroupId, turnLive);
      const pendingSend = pendingByMessageId.get(group.messageId);
      return withQueueSend(result, pendingSend ?? acceptedByMessageId.get(group.messageId), pendingSend !== undefined);
    }),
    messages,
    groups,
    turnLive,
    showThinking,
    showAfterQuery: showThinking && liveAssistantMessages.length === 0 && streamPhase === "waiting" && streamMessages.some((message) => message.role === "user"),
    turns,
    showEmptyState,
  };
}

function projectLiveGroupViews(input: {
  readonly groups: readonly WebuiTranscriptGroup[];
  readonly streamMessages: WebuiTranscriptStreamMessages;
  readonly sessionId: string;
  readonly streamPhase: WebuiTranscriptStreamPhase;
  readonly processingStartedAtMs: number | undefined;
  readonly turnLive: boolean;
}): ReadonlyMap<string, LiveGroup> | undefined {
  if (!input.turnLive) return undefined;
  const views = new Map<string, LiveGroup>();
  const byId = new Map(input.streamMessages.map((message) => [message.id, message]));
  for (const group of input.groups) {
    const owned = new Set(group.items.map((item) => item.messageId));
    const own = [...owned].flatMap((id) => { const message = byId.get(id); return message ? [message] : []; });
    if (own.length === 0) continue;
    const assistant = own.filter((message) => message.role !== "user");
    const last = assistant[assistant.length - 1];
    if (!last) continue;
    views.set(group.messageId, {
      assistantMessageId: last.id,
      streaming: input.streamPhase === "streaming",
      processingStartedAtMs: input.processingStartedAtMs,
    });
  }
  return views.size > 0 ? views : undefined;
}

function projectTrailingLiveGroupId(
  groups: readonly WebuiTranscriptGroup[],
  streamMessages: WebuiTranscriptStreamMessages,
): string | undefined {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group) continue;
    const owned = new Set(group.items.map((item) => item.messageId));
    if (streamMessages.some((message) => owned.has(message.id))) {
      return group.messageId;
    }
  }
  return undefined;
}

/** The navigator's tick list: one row per assistant block. A user turn is not a
 *  tick — only the assistant block that follows it counts. The first row is
 *  `active` while nothing has settled; the last is `running` while streaming. */
function projectTurnRows(
  groups: readonly WebuiTranscriptGroup[],
  streamPhase: WebuiTranscriptStreamPhase,
): readonly WebuiTranscriptTurnRow[] {
  const assistantGroups = groups.filter((group) =>
    group.items.some((item) => item.kind === "assistant"),
  );
  if (assistantGroups.length === 0) return [];
  const lastIndex = assistantGroups.length - 1;
  return assistantGroups.map((group, index) => ({
    id: group.messageId,
    state:
      index === lastIndex && streamPhase === "streaming"
        ? "running"
        : index === 0
          ? "active"
          : "default",
  }));
}
