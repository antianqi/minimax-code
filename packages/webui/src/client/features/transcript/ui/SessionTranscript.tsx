// SessionTranscript — the per-session message log: groups, projectWebuiMessage
// flattening, history paging, streaming loader, and the embedded
// WebuiQuestionnaireResponse renderer for historical questionnaire answers.

import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { IconChevronUp } from "@tabler/icons-react";
import { ChatSkeleton } from "./TranscriptSkeletons.js";
import { ActivityIndicator, MessageAfterQueryStreamingPlaceholder } from "./ActivityIndicator.js";
import { TurnNavigator, type TurnNavigatorPreview } from "./TurnNavigator.js";
import { MessageItem } from "./MessageItem.js";
import { formatWebuiMessageTimestamp } from "../projection/message-timestamp.js";
import { useWebuiSessionQuestionnaire, useWebuiSessionTranscript, useWebuiSessionStream, useWebuiTranscriptHistoryOwner, useWebuiTranscriptSettlementOwner } from "../../../bindings/use-session-state.js";
import { isWebuiPlanReviewRequest } from "../../interactions/contracts/plan-mode.js";
import { WebuiTranscriptPlanDelivery } from "./PlanDelivery.js";
import { WebuiQuestionnaireResponse } from "./QuestionnaireResponse.js";
import type { WebuiClientMessagePage } from "../contracts/message-view.js";
import type { WebuiTranscriptItem } from "../contracts/transcript-view.js";
import type { WebuiTranscriptCommands } from "../contracts/session-read-port.js";
import type { WebuiQuestionnaireRequest } from "../../../../shared/contracts/interactions.js";
import { scrollWebuiTargetIntoView } from "../../../bindings/browser-effects.js";
import { WebuiInline, WebuiStack } from "../../../ui/layout-primitives.js";
import { useWebuiToastError } from "../../../ui/toast.js";

import type { WebuiMessageFileReference } from "../projection/message-file-reference.js";
import type { WorkspacePanelCommand } from "../../workspace/contracts/panel-command.js";
import {
  type WebuiTranscriptGroup,
} from "../projection/transcript-projection.js";
import { projectWebuiTranscriptView } from "../projection/transcript-view-model.js";
import {
  transcriptViewport,
  useWebuiTranscriptScroll,
} from "../bindings/use-transcript-scroll.js";
import { WebuiWorkspaceFileUrlProvider } from "./markdown.public.js";
import { WebuiButton } from "../../../ui/button.js";

import { FeedbackBusy, FeedbackEmpty } from "../../../ui/feedback.js";
const EMPTY_TRANSCRIPT_PAGE: WebuiClientMessagePage = {};


// --- TurnNavigator integration ------------------------------------------------
//
// `TurnNavigator` is the presentational seam and defers hover, scroll and jump
// to this integrator. The helpers below are that integration's pure halves,
// exported so the node-environment suite can assert them without a DOM: which
// message a tick anchors to, what one turn's hover preview shows, and what a
// reveal does to its target. The mouse wiring itself (setState on hover,
// querySelector on activate) stays in the component and is the boundary SSR
// cannot reach.

/** Every rendered message root carries `data-message-id` (MessageItem), so a
 *  tick reuses that attribute as its anchor instead of a second anchor
 *  system. Quotes and backslashes are escaped so a message id cannot close
 *  the attribute selector. */
export function turnNavigatorAnchorSelector(turnId: string): string {
  return `[data-message-id="${turnId.replace(/["\\]/g, "\\$&")}"]`;
}

export const TURN_NAVIGATOR_FLASH_CLASS = "webui-turn-jump-flash";
const TURN_NAVIGATOR_FLASH_MS = 1200;

export interface WebuiTurnRevealTarget {
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  readonly classList: { add(token: string): void; remove(token: string): void };
}

/** Reveal one turn after a tick activation: center it in the transcript
 *  viewport and flash it so the destination is findable. The class is removed
 *  after `flashMs` so the highlight stays transient. */
export function revealTurnNavigatorAnchor(
  target: WebuiTurnRevealTarget,
  flashMs = TURN_NAVIGATOR_FLASH_MS,
): void {
  scrollWebuiTargetIntoView(target, { block: "center" });
  target.classList.add(TURN_NAVIGATOR_FLASH_CLASS);
  setTimeout(() => target.classList.remove(TURN_NAVIGATOR_FLASH_CLASS), flashMs);
}

const TURN_NAVIGATOR_RESPONSE_MAX_CHARS = 120;

/** The preview's one-line answer summary: the first non-empty line, capped. */
function firstTurnSummaryLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  return line.length > TURN_NAVIGATOR_RESPONSE_MAX_CHARS
    ? `${line.slice(0, TURN_NAVIGATOR_RESPONSE_MAX_CHARS - 1)}…`
    : line;
}

function hasAssistantItems(group: WebuiTranscriptGroup): boolean {
  return group.items.some((item) => item.kind === "assistant");
}

function turnUserQuery(
  groups: readonly WebuiTranscriptGroup[],
  fromIndex: number,
  step: 1 | -1,
): string | undefined {
  for (let index = fromIndex; index >= 0 && index < groups.length; index += step) {
    const userItem = groups[index]?.items.find(
      (item): item is Extract<WebuiTranscriptItem, { text: string }> => item.kind === "user",
    );
    if (userItem) return userItem.text;
  }
  return undefined;
}

/** The hover preview for one tick: the turn's 1-based number among the
 *  assistant blocks the strip lists, its first answer line as the summary, the
 *  group's own timestamp, framed by the user queries on both sides. Returns
 *  null when the id is not one of the assistant turns the strip lists — the
 *  numbering and membership mirror `projectTurnRows`. */
export function projectTurnNavigatorPreview(input: {
  readonly turnId: string;
  readonly groups: readonly WebuiTranscriptGroup[];
}): TurnNavigatorPreview | null {
  const assistantGroups = input.groups.filter(hasAssistantItems);
  const tickIndex = assistantGroups.findIndex((group) => group.messageId === input.turnId);
  if (tickIndex < 0) return null;
  const group = assistantGroups[tickIndex]!;
  const groupIndex = input.groups.indexOf(group);
  const answer = group.items.find(
    (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
      item.kind === "assistant" && item.text.trim().length > 0,
  );
  const time = formatWebuiMessageTimestamp(
    group.items.find((item) => typeof item.timestamp === "number")?.timestamp,
  );
  const previousQuery = groupIndex > 0 ? turnUserQuery(input.groups, groupIndex - 1, -1) : undefined;
  const nextQuery =
    groupIndex >= 0 && groupIndex < input.groups.length - 1
      ? turnUserQuery(input.groups, groupIndex + 1, 1)
      : undefined;
  return {
    title: `第 ${tickIndex + 1} 轮`,
    ...(time ? { time } : {}),
    ...(previousQuery ? { previousQuery } : {}),
    ...(nextQuery ? { nextQuery } : {}),
    ...(answer ? { response: firstTurnSummaryLine(answer.text) } : {}),
  };
}

function WebuiSessionTranscriptView({
  sessionId,
  initialMessages,
  transcriptCommands,
  compactionRunning = false,
  compactionOutput,
  answerPlanBuild,
  workspaceDir,
  workspaceFileUrl,
  onOpenFile,
  onOpenTurnReview,
  onOpenPlanFile,
}: {
  readonly sessionId: string;
  readonly initialMessages?: WebuiClientMessagePage;
  readonly compactionRunning?: boolean;
  readonly compactionOutput?: string;
  readonly workspaceDir?: string;
  /** Serves a workspace file's bytes, so a linked image or clip can be drawn in place. */
  readonly workspaceFileUrl?: (input: { readonly workspaceDir: string; readonly path: string }) => string;
  readonly onOpenFile?: (input: { readonly sessionId: string; readonly workspaceDir: string; readonly reference: WebuiMessageFileReference }) => void;
  readonly onOpenTurnReview?: (command: Extract<WorkspacePanelCommand, { type: "open-turn-review" }>) => void;
  readonly onOpenPlanFile?: (input: { readonly sessionId: string; readonly path: string; readonly content: string }) => void;
  readonly answerPlanBuild?: (request: WebuiQuestionnaireRequest) => Promise<void>;
  readonly transcriptCommands?: WebuiTranscriptCommands;
}): ReactElement {
  const historyOwner = useWebuiTranscriptHistoryOwner();
  const settlementOwner = useWebuiTranscriptSettlementOwner();
  const transcriptState = useWebuiSessionTranscript(sessionId);
  const hasCanonicalPage = transcriptState.page.messages !== undefined;
  const visiblePage = hasCanonicalPage
    ? transcriptState.page
    : initialMessages ?? transcriptState.page ?? EMPTY_TRANSCRIPT_PAGE;
  const loading = hasCanonicalPage
    ? transcriptState.loading
    : initialMessages
      ? false
      : transcriptState.loading;
  const error = transcriptState.error;
  // The load failure is said once and it leaves the layout alone: the list
  // below is either empty or already drawn, and a notice that takes room
  // from it is a state pretending to be a message.
  useWebuiToastError(error === undefined ? undefined : `Unable to load messages: ${error}`);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const stream = useWebuiSessionStream(sessionId);
  const streamPhase = stream.phase;
  // The plan file is a MESSAGE in the transcript, not a floating card: the
  // it is rendered as the footer of the turn that wrote the plan. It lives
  // on the pending questionnaire, so the transcript reads the same channel the
  // composer does and anchors the card to `request.tool.messageId`.
  //
  // The composer keeps its own copy for the decision; this read only decides
  // whether a plan card belongs in the message column.
  const pendingQuestionnaire = useWebuiSessionQuestionnaire(sessionId);
  const planReview = isWebuiPlanReviewRequest(pendingQuestionnaire)
    ? pendingQuestionnaire
    : undefined;
  // The card is a MESSAGE in the transcript, not a floating card: it anchors to
  // the turn that wrote the plan.
  const planAnchorMessageId = planReview?.tool?.messageId;
  // History and stream frames feed one transcript projection. The live
  // records update the same message identities in this list while history
  // supplies the persisted fields and older messages.
  useEffect(() => {
    if (initialMessages) historyOwner?.seed(sessionId, initialMessages);
    void historyOwner?.loadPage(sessionId);
  }, [historyOwner, initialMessages, sessionId]);
  // One view model, derived in one place (`projection/transcript-view-model.ts`);
  // this component renders what it returns.
  const view = useMemo(
    () =>
      projectWebuiTranscriptView({
        sessionId,
        visiblePage,
        streamMessages: stream.messages,
        retainedMessages: transcriptState.retainedMessages,
        queueSends: transcriptState.queueSends,
        streamPhase,
        messageSource: stream.messageSource,
        processingStartedAtMs: stream.processingStartedAtMs,
        loading,
        error,
      }),
    [
      error,
      loading,
      sessionId,
      stream.messages,
      stream.processingStartedAtMs,
      streamPhase,
      stream.messageSource,
      transcriptState.retainedMessages,
      transcriptState.queueSends,
      visiblePage,
    ],
  );
  const {
    groups,
    renderGroups,
    turnLive,
    showThinking,
    showAfterQuery,
    turns,
    showEmptyState,
  } = view;
  const compactionSummary = compactionOutput?.replace(/\s*\r?\n\s*/gu, " · ").trim();
  // The scroll binding owns the viewport, the auto-follow policy and the pin.
  const { releaseAutoFollow } = useWebuiTranscriptScroll({
    transcriptRef,
    sessionId,
    turnLive,
  });
  // The navigator's tick interactions: hover decides which turn the preview
  // card describes, activation jumps the viewport to that turn's message root.
  // `TurnNavigator` renders; this integrator owns the state and the DOM.
  const [hoveredTurnId, setHoveredTurnId] = useState<string>();
  const navigatorPreview = useMemo(
    () =>
      hoveredTurnId
        ? projectTurnNavigatorPreview({ turnId: hoveredTurnId, groups })
        : null,
    [groups, hoveredTurnId],
  );
  const activateNavigatorTick = (turnId: string) => {
    const anchor = transcriptRef.current?.querySelector<HTMLElement>(
      turnNavigatorAnchorSelector(turnId),
    );
    if (!anchor) return;
    // 跳转是读者主动离开贴底跟随：先交还控制权，否则后续内容增长会把
    // 视口从落点拽回底部（loadOlder 出于同一原因先释放）。
    releaseAutoFollow();
    revealTurnNavigatorAnchor(anchor);
  };
  const loadOlder = visiblePage.hasMore && visiblePage.nextCursor
    ? () => {
        if (loading) return;
        const requestedCursor = visiblePage.nextCursor;
        if (!requestedCursor) return;
        // 翻历史是用户主动往上走：交还控制权，否则更早消息并进来之后
        // 贴底跟随会把他从正在读的位置拽回末尾。
        releaseAutoFollow();
        const viewport = transcriptViewport(transcriptRef.current);
        const previousScrollTop = viewport?.scrollTop;
        void historyOwner?.loadOlder(sessionId, requestedCursor).then((outcome) => {
          requestAnimationFrame(() => {
            if (
              outcome.status === "applied" &&
              historyOwner.isCurrentPage(outcome.page) &&
              transcriptRef.current?.dataset.webuiTranscript === sessionId &&
              viewport?.isConnected &&
              previousScrollTop !== undefined
            ) {
              viewport.scrollTop = previousScrollTop;
            }
          });
        });
      }
    : undefined;
  // A new function each render is fine: the media elements it feeds only reload
  // when the URL itself changes.
  const buildFileUrl = workspaceFileUrl && workspaceDir
    ? (path: string) => workspaceFileUrl({ workspaceDir, path })
    : undefined;

  return (
    <WebuiWorkspaceFileUrlProvider build={buildFileUrl}>
    <section
      ref={transcriptRef}
      aria-label="Transcript"
      data-webui-transcript={sessionId}
      data-webui-transcript-synchronization={transcriptState.synchronization?.phase}
      data-webui-transcript-empty={showEmptyState ? "true" : undefined}
      className="message-container-viewport scrollbar-hide webui-session-transcript-scroll relative flex w-full flex-col"
      data-webui-session-transcript-scroll="true"
    >
      <WebuiStack
        gap="small"
        className="message-list w-full"
        data-webui-message-list="true"
      >
        {!turnLive && loading && renderGroups.length === 0 ? <ChatSkeleton /> : null}
        {showEmptyState ? (
          <FeedbackEmpty
            className="webui-transcript-empty-state"
            title="当前会话暂无消息"
            testId="transcript-empty-state"
          />
        ) : null}
        {transcriptState.synchronization?.phase === "failed" ? (
          <WebuiInline gap="small" data-webui-transcript-sync="failed">
            <span role="status">回复内容已保留，历史记录尚未同步。</span>
            <WebuiButton variant="plain" size="regular" onClick={() => settlementOwner?.retry(sessionId)}>重试同步</WebuiButton>
          </WebuiInline>
        ) : null}
        {loadOlder ? (
          <WebuiInline align="stretch" justify="center" className="w-full py-1">
            <WebuiButton variant="grouped" size="pill" onClick={loadOlder}
              disabled={loading}
              aria-label={loading ? "正在加载更早消息" : "加载更早消息"}
            >
              <IconChevronUp aria-hidden="true" className="size-4 flex-none" size={16} stroke={1.7} />
              <span>{loading ? "正在加载…" : "加载更早消息"}</span>
            </WebuiButton>
          </WebuiInline>
        ) : null}
        {renderGroups.map(({ group, view: messageView, questionnaire }) => (
          <Fragment key={messageView?.renderKey ?? group.messageId}>
            {questionnaire ? (
              <WebuiQuestionnaireResponse
                key={`${group.messageId}-questionnaire`}
                messageId={group.messageId}
                summary={questionnaire.summary}
                timestamp={questionnaire.timestamp}
              />
            ) : null}
            {messageView ? (
              <MessageItem
                view={messageView}
                wallClockDurationMs={group.wallClockDurationMs}
                transcriptCommands={transcriptCommands}
                workspaceDir={workspaceDir}
                onOpenFile={onOpenFile}
                onOpenTurnReview={onOpenTurnReview}
              />
            ) : null}
              {messageView?.role === "assistant" && planAnchorMessageId !== undefined &&
              group.items.some((item) => item.messageId === planAnchorMessageId) ? (
                <div
                  key={`${group.messageId}-plan`}
                  className="webui-plan-inline"
                  data-testid="plan-inline-anchor"
                >
                  {planReview ? (
                    <WebuiTranscriptPlanDelivery
                      sessionId={sessionId}
                      request={planReview}
                      answerPlanBuild={answerPlanBuild}
                      onOpenPlanFile={onOpenPlanFile}
                    />
                  ) : null}
                </div>
              ) : null}
          </Fragment>
        ))}
        {showAfterQuery ? <MessageAfterQueryStreamingPlaceholder /> : null}
        {showThinking ? (
          <div className="webui-session-stream-status" data-webui-live-thinking="true">
            <ActivityIndicator showLabel labelOverride="思考中…" />
          </div>
        ) : null}
        {compactionRunning ? (
          // The row is the suite's marker; the announcement belongs to the shared
          // busy family, which owns the live region and the spinner.
          <div
            className="mt-2 w-full min-w-0 text-text_default_secondary text-size_13 leading-line_height_20"
            data-webui-command-running="true"
          >
            <FeedbackBusy label="正在压缩会话…" />
          </div>
        ) : compactionSummary ? (
          <div className="mt-2 w-full min-w-0" data-webui-compaction-result="true">
            <div
              role="separator"
              aria-orientation="horizontal"
              className="mb-2 h-px w-full bg-border_default"
            />
            <p
              className="w-full truncate text-text_default_secondary text-size_12 leading-line_height_16"
              data-webui-command-output="true"
              title={compactionSummary}
            >
              {compactionSummary}
            </p>
          </div>
        ) : null}
      </WebuiStack>
      <TurnNavigator
        turns={turns}
        preview={navigatorPreview}
        onTickHover={(turnId) => setHoveredTurnId(turnId)}
        onTickLeave={(turnId) =>
          setHoveredTurnId((current) => (current === turnId ? undefined : current))
        }
        onTickActivate={(turnId) => activateNavigatorTick(turnId)}
      />
    </section>
    </WebuiWorkspaceFileUrlProvider>
  );
}

export const WebuiSessionTranscript = memo(WebuiSessionTranscriptView);
