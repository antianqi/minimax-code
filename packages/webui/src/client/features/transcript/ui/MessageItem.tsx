// MessageItem — the single message renderer shared by persisted history and
// the live turn.
//
// The component consumes the narrowed `WebuiTurnView` (union of
// `WebuiHistoricalTurnView` and `WebuiLiveTurnView`) as the data source.
// Side-specific fields (`initialDiff`, `streaming`, `processSegments`, …)
// are accessed via narrow on `view.source`. The runtime contract is
// view-only.
//
// The application retains content and the transcript projector supplies the
// final historical/live view; this component renders that view.

import { memo, useCallback, useRef, useState, type ReactElement } from "react";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import type {
  WebuiGetSessionForkOptionsResult,
  WebuiGetSessionRewindPreviewResult,
  WebuiTurnDiffView,
} from "../../../../shared/contracts/session.js";
import type { WebuiTranscriptCommands } from "../contracts/session-read-port.js";
import type { WebuiMessageFileReference } from "../projection/message-file-reference.js";
import { projectWebuiDiffFiles } from "../../../projection/common/diff-workspace-boundary.js";
import type { WorkspacePanelCommand } from "../../workspace/contracts/panel-command.js";
import type {
  WebuiHistoricalTurnView,
  WebuiLiveTurnView,
  WebuiTurnView,
} from "../projection/transcript-shape.js";

import { WebuiAssistantBody } from "./AssistantBody.js";
import { WebuiIconCommandGoal } from "../../../shell/icons.js";
import {
  WebuiMessageActions,
  WebuiRewindDialog,
} from "./MessageActions.js";
import {
  buildWebuiEditRequest,
  buildWebuiMessageForkRequest,
  buildWebuiRewindRequest,
  webuiClientRequestId,
} from "../../sessions/projection/action-requests.public.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDialog, WebuiDialogActions } from "../../../ui/dialog.js";
import { WebuiField, WebuiTextarea, WebuiTextInput, useWebuiFormValidation } from "../../../ui/field.js";
import { WebuiInline, WebuiStack } from "../../../ui/layout-primitives.js";
import { useWebuiToastError } from "../../../ui/toast.js";
import { FeedbackLiveRegion } from "../../../ui/feedback.js";

/**
 * The single message renderer shared by persisted history and the live turn.
 * Data flows in exclusively through `view`; no per-field legacy props.
 *
 * The single remaining non-view prop is `wallClockDurationMs` — it is
 * group-level (sum-of-frame span across the assistant group), not a
 * per-message fact. Neither adapter can produce it; `SessionTranscript`
 * reads it from the final group projection and passes it here.
 */
interface MessageItemProps {
  readonly view: WebuiTurnView;
  readonly wallClockDurationMs?: number;
  readonly workspaceDir?: string;
  readonly onOpenFile?: (input: { readonly sessionId: string; readonly workspaceDir: string; readonly reference: WebuiMessageFileReference }) => void;
  readonly onOpenTurnReview?: (command: Extract<WorkspacePanelCommand, { type: "open-turn-review" }>) => void;
  readonly transcriptCommands?: WebuiTranscriptCommands;
}

function areMessageItemPropsEqual(previous: MessageItemProps, next: MessageItemProps): boolean {
  return previous.wallClockDurationMs === next.wallClockDurationMs &&
    previous.workspaceDir === next.workspaceDir &&
    previous.onOpenFile === next.onOpenFile &&
    previous.onOpenTurnReview === next.onOpenTurnReview &&
    previous.transcriptCommands === next.transcriptCommands &&
    previous.view === next.view;
}

function MessageItemView({
  view,
  wallClockDurationMs,
  transcriptCommands = {},
  workspaceDir,
  onOpenFile,
  onOpenTurnReview,
}: MessageItemProps): ReactElement {
  const { dom, dataDir } = useWebuiBrowserCapabilities();
  // Narrowing: historical view can read historical-only fields; live view
  // can read live-only fields. The union member types live in
  // `transcript-shape.ts`.
  const messageId = view.messageId;
  const role = view.role;
  const isHistorical = view.source === "historical";
  const historicalView: WebuiHistoricalTurnView | undefined = isHistorical
    ? view
    : undefined;
  const liveView: WebuiLiveTurnView | undefined = !isHistorical
    ? view
    : undefined;
  // Shared fields are read directly from the union base.
  const sessionId = view.sessionId;
  const userText = view.userText;
  const thinking = view.thinking;
  const tools = view.tools;
  const answers = view.answers;
  const timestamp = view.timestamp;
  const isGoal = view.isGoal;
  const totalRequestDurationMs = view.totalRequestDurationMs;
  const totalOutputTokens = view.totalOutputTokens;
  // Historical-only (`turnId` / `thinkingDurationMs` /
  // `initialDiff` / `actions` / `attachments`).
  const turnId = historicalView?.turnId;
  const processForceExpanded = historicalView?.processForceExpanded;
  const thinkingDurationMs = historicalView?.thinkingDurationMs;
  const initialDiff = historicalView?.initialDiff;
  const actions = historicalView?.actions;
  const attachments = historicalView?.attachments;
  // Live-only fields. `processSegments` is shared on the view because
  // history supplies it at group level and the live adapter supplies it.
  const assistantMessageId = liveView?.assistantMessageId;
  const streaming = liveView?.streaming;
  const streamMessageId = liveView?.streamMessageId;
  const messageRootId = liveView?.messageRootId;
  const processingStartedAtMs = liveView?.processingStartedAtMs;
  const processSegments = view.processSegments;

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(userText ?? "");
  const [rewindOpen, setRewindOpen] = useState(false);
  const [rewindPreview, setRewindPreview] = useState<WebuiGetSessionRewindPreviewResult>();
  const [rewindLoading, setRewindLoading] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [forkTitle, setForkTitle] = useState("");
  const [forkOpen, setForkOpen] = useState(false);
  const [forkOptions, setForkOptions] = useState<WebuiGetSessionForkOptionsResult>();
  // The fork options arrive after the dialog is already open, so the suggested
  // title is a late reply. Track whether the person has typed a name, so a
  // late reply cannot overwrite what they wrote.
  const forkTitleEdited = useRef(false);
  const { errors: editErrors, validateRequired, clearFieldError } = useWebuiFormValidation();
  // The mutation failure is said once, and it leaves the layout alone. The
  // guard is the one the inline error had: the dialogs that own their own
  // failure speak for themselves while they are open, and the assistant row
  // is the only one that carried the notice beside the message.
  useWebuiToastError(
    role === "assistant" && !rewindOpen && !forkOpen ? mutationError : undefined,
  );
  const openRewind = () => {
    setRewindOpen(true);
    setRewindPreview(undefined);
    setMutationError(undefined);
    if (!sessionId || !transcriptCommands.getSessionRewindPreview) return;
    setRewindLoading(true);
    void transcriptCommands.getSessionRewindPreview({ id: sessionId, userMessageId: messageId })
      .then(setRewindPreview)
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setRewindLoading(false));
  };
  const confirmRewind = (rewindTurnDiff: boolean) => {
    if (!sessionId || !transcriptCommands.rewindSession || !actions?.rewind) return;
    setMutationBusy(true);
    void transcriptCommands.rewindSession(buildWebuiRewindRequest(sessionId, messageId, webuiClientRequestId("rewind"), rewindTurnDiff))
      .then(() => { setRewindOpen(false); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const submitEdit = () => {
    if (!sessionId || !transcriptCommands.editSessionMessage || !(actions?.edit ?? actions?.rewind)) return;
    if (!validateRequired([{ name: "text", label: "消息内容", value: editText }])) return;
    const request = buildWebuiEditRequest(sessionId, messageId, webuiClientRequestId("edit"), editText);
    if (!request) return;
    setMutationBusy(true);
    void transcriptCommands.editSessionMessage(request)
      .then(() => { setEditing(false); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const confirmFork = () => {
    if (!sessionId || !transcriptCommands.forkSession || forkOptions?.canFork === false) return;
    setMutationBusy(true);
    void transcriptCommands.forkSession(buildWebuiMessageForkRequest(sessionId, messageId, webuiClientRequestId("fork"), forkTitle))
      .then(() => { setForkOpen(false); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const openFork = () => {
    setForkOpen(true);
    setForkOptions(undefined);
    forkTitleEdited.current = false;
    setForkTitle("");
    if (!sessionId || !transcriptCommands.getSessionForkOptions) return;
    void transcriptCommands.getSessionForkOptions({ id: sessionId, assistantMessageId: assistantMessageId ?? messageId })
      .then((nextOptions) => {
        setForkOptions(nextOptions);
        if (nextOptions.suggestedTitle && !forkTitleEdited.current) setForkTitle(nextOptions.suggestedTitle);
      })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)));
  };
  // The two callbacks the body hands down are stable across renders. An
  // inline arrow would give the body a new identity on every streamed frame,
  // which defeats the markdown renderer's own memo and its block reuse — the
  // answer is re-rendered from scratch on every frame that arrives.
  const handleOpenFile = useCallback(
    (reference: WebuiMessageFileReference) => {
      if (sessionId && workspaceDir) onOpenFile?.({ sessionId, workspaceDir, reference });
    },
    [onOpenFile, sessionId, workspaceDir],
  );
  const handleOpenTurnReview = useCallback(
    (review: WebuiTurnDiffView, selectedPath?: string) => {
      if (!sessionId || !workspaceDir) return;
      onOpenTurnReview?.({ type: "open-turn-review", sessionId, workspaceDir, messageId, assistantMessageId: review.sourceMessageId ?? assistantMessageId ?? messageId, ...(turnId ? { turnId } : {}), ...(review.changeSetId ? { changeSetId: review.changeSetId } : {}), files: projectWebuiDiffFiles(review.fileChanges, workspaceDir, { dataDir, sessionId }), ...(selectedPath ? { selectedPath } : {}) });
    },
    [assistantMessageId, dataDir, messageId, onOpenTurnReview, sessionId, turnId, workspaceDir],
  );
  const actionProps = {
    role,
    messageId,
    copyText: role === "user" ? userText ?? "" : answers?.join("\n\n") ?? "",
    actions,
    onRewind: role === "user" ? openRewind : undefined,
    onEdit: role === "user" ? () => { setEditText(userText ?? ""); validateRequired([]); setEditing(true); } : undefined,
    onFork: role === "assistant" ? openFork : undefined,
    timestamp,
  };
  // The dialog is rendered conditionally, so the layer is only active while it is
  // on screen: an inactive layer casts no vote.
  const forkDialog = (
    <WebuiDialog id="fork-dialog" open={forkOpen} title="复制为新会话" description={forkOptions?.unavailableReason ?? "保留当前上下文，在新会话中继续"} onClose={() => setForkOpen(false)} dismissOnEscape portalTarget={dom.portalTarget()} testId="fork-dialog" width="compact" footer={<WebuiDialogActions>
      <WebuiButton variant="secondary" onClick={() => setForkOpen(false)} disabled={mutationBusy}>取消</WebuiButton>
      <WebuiButton variant="primary" onClick={confirmFork} disabled={mutationBusy || forkOptions?.canFork === false}>复制并进入</WebuiButton>
    </WebuiDialogActions>}>
        <WebuiTextInput aria-label="会话名称" value={forkTitle} onChange={(event) => { forkTitleEdited.current = true; setForkTitle(event.target.value); }} placeholder="使用简短且不同的名称，便于识别" disabled={forkOptions?.canFork === false} />
    </WebuiDialog>
  );
  const renderedForkDialog = forkDialog;
  if (role === "user") {
    return (
      <div
        className="webui-message message-animate-in group relative"
        data-webui-stream-message={streamMessageId}
        data-webui-message-root={messageRootId ?? messageId}
        data-webui-message-role="user"
        data-webui-pending-queue-item={view.queueSend?.itemId}
        data-webui-queue-send-phase={view.queueSend?.phase}
        data-testid="message-item"
        data-role="user"
        data-message-id={messageId}
        data-webui-goal-message={isGoal ? "true" : undefined}
        data-message-timestamp={timestamp}
      >
        <WebuiInline align="stretch" justify="end" className="w-full">
          <WebuiStack gap="small" align="end" className="w-full">
            {editing ? (
              <WebuiStack gap="medium" className="webui-user-inline-editor" data-testid="user-message-inline-editor">
                <WebuiField label="消息内容" required error={editErrors.text} control={(props) => <WebuiTextarea {...props} className="webui-user-inline-editor-control" value={editText} placeholder="编辑消息内容" onChange={(event) => { setEditText(event.target.value); clearFieldError("text"); }} autoFocus />} />
                <div className="webui-inline-editor-actions"><WebuiButton variant="secondary" onClick={() => { validateRequired([]); setEditing(false); }} disabled={mutationBusy}>取消</WebuiButton><WebuiButton variant="primary" onClick={submitEdit} disabled={mutationBusy || !(actions?.edit ?? actions?.rewind)}>发送</WebuiButton></div>
              </WebuiStack>
            ) : <div
              className="webui-user-bubble rounded-[16px] px-3 py-2 max-w-[80%]"
              data-webui-user-bubble="true"
            >
              <div className="webui-user-text-clamp">
                <p
                  className="webui-user-text"
                  data-webui-message-kind="user"
                  data-webui-user-text="true"
                >
                  {isGoal ? (
                    <span className="webui-user-goal-label" data-webui-goal-label="true">
                      <WebuiIconCommandGoal aria-hidden="true" />
                      <span>Goal</span>
                    </span>
                  ) : null}
                  <span>{userText ?? ""}</span>
                </p>
              </div>
            </div>}
            {view.queueSend ? (
              <WebuiStack gap="small" align="end">
                <FeedbackLiveRegion className="text-text_default_secondary text-size_12">
                  {view.queueSend.phase === "pending" ? "正在立即发送" : view.queueSend.phase === "accepted" ? "已受理，等待处理" : view.queueSend.phase === "failed" ? "立即发送失败" : "发送结果待确认"}
                  {view.queueSend.error ? `：${view.queueSend.error}` : ""}
                </FeedbackLiveRegion>
                {view.queueSend.phase === "failed" && sessionId && transcriptCommands.retryQueueSend ? <WebuiButton variant="secondary" onClick={() => transcriptCommands.retryQueueSend!(sessionId, view.queueSend!.itemId)}>重试发送</WebuiButton> : null}
                {view.queueSend.phase === "unknown" && sessionId && transcriptCommands.recheckQueueSend ? <WebuiButton variant="secondary" onClick={() => transcriptCommands.recheckQueueSend!(sessionId)}>重新核对</WebuiButton> : null}
              </WebuiStack>
            ) : !editing ? <WebuiMessageActions {...actionProps} /> : null}
            <WebuiRewindDialog open={rewindOpen} messageId={messageId} preview={rewindPreview} loading={rewindLoading} error={mutationError} busy={mutationBusy} mutationBlocked={!actions?.rewind} onClose={() => setRewindOpen(false)} onConfirm={confirmRewind} />
          </WebuiStack>
        </WebuiInline>
      </div>
    );
  }
  return (
    <div
      className="webui-message message-animate-in group relative"
      data-webui-stream-message={streamMessageId}
      data-webui-message-root={messageRootId ?? messageId}
      data-webui-message-role="assistant"
      data-testid="message-item"
      data-role="assistant"
      data-message-id={messageId}
    >
      <WebuiAssistantBody
        messageId={messageId}
        sessionId={sessionId}
        workspaceDir={workspaceDir}
        onOpenFile={handleOpenFile}
        onOpenTurnReview={handleOpenTurnReview}
        assistantMessageId={assistantMessageId ?? initialDiff?.sourceMessageId ?? messageId}
        turnId={turnId}
        changeSetId={initialDiff?.changeSetId}
        initialDiff={initialDiff}
        thinking={thinking}
        thinkingDurationMs={thinkingDurationMs}
        tools={tools}
        answers={answers ?? []}
        attachments={attachments}
        streaming={streaming}
        processingStartedAtMs={processingStartedAtMs}
        totalRequestDurationMs={totalRequestDurationMs}
        totalOutputTokens={totalOutputTokens}
        wallClockDurationMs={wallClockDurationMs}
        processSegments={processSegments}
        processForceExpanded={processForceExpanded}
      />
      <WebuiMessageActions {...actionProps} />
      {renderedForkDialog}
    </div>
  );
}

export const MessageItem = memo(MessageItemView, areMessageItemPropsEqual);
