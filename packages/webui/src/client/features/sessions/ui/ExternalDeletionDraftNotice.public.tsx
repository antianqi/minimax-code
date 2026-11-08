// The notice that reports a session somebody else deleted, and what it does with
// the input that was still unsent for it.
//
// It is the only new user-visible surface here, and deliberately a
// per-feature notice rather than a shell notification system: the fact is
// Sessions', the input is the composer's, and the three ways out are the user's.
// It reuses the banner pattern the conversation surface already renders, so it
// appears where the user is composing rather than in a corner they have to notice.
//
// It is disabled-by-default in the sense that matters: the retained input is not
// inserted into any editor, is not resent, and is not re-created as a task. The
// three actions are the only ways it leaves — copy the text, transfer it to the
// task the user is in, or discard it. Acknowledged text copy leaves uncopied
// attachments and references available for transfer; the notice retires only
// when all retained input has been handled.

import { useState, type ReactElement } from "react";

import type { WebuiRetainedDeletionDraft } from "../application/session-workflows.js";
import { FeedbackError, FeedbackLiveRegion } from "../../../ui/feedback.js";
import { WebuiInline } from "../../../ui/layout-primitives.js";
import { WebuiButton } from "../../../ui/button.js";

export interface WebuiExternalDeletionNoticeProps {
  readonly drafts: readonly WebuiRetainedDeletionDraft[];
  /** Requests text copy; the owner preserves input the clipboard cannot copy. */
  readonly onCopy: (sessionId: string) => void;
  /** Merges retained input into the current task, preserving its existing input. */
  readonly onTransfer: (sessionId: string) => void;
  readonly onDiscard: (sessionId: string) => void;
}

export function WebuiExternalDeletionNotice({
  drafts,
  onCopy,
  onTransfer,
  onDiscard,
}: WebuiExternalDeletionNoticeProps): ReactElement | null {
  const [transferError, setTransferError] = useState<{ readonly sessionId: string; readonly message: string }>();
  if (drafts.length === 0) return null;
  return (
    <FeedbackLiveRegion
      testId="external-deletion-notice"
      className="mx-auto w-full max-w-[743px] rounded-lg border border-border_default bg-bg_default_secondary px-spacing_8 py-spacing_4 text-size_12 leading-line_height_16"
    >
      {drafts.map((draft) => {
        const staged = draft.attachments.length + draft.urlReferences.length;
        return (
          <div key={draft.sessionId} data-testid={`external-deletion-draft-${draft.sessionId}`}>
            <p>这个任务已被其他客户端删除。</p>
            <p>
              未发送的内容仍保留在这里：
              {draft.draft ? <span data-testid="external-deletion-draft-text">{draft.draft}</span> : null}
              {staged > 0 ? <span data-testid="external-deletion-draft-attachments">（{staged} 个附件）</span> : null}
            </p>
            <WebuiInline gap="small">
              <WebuiButton variant="quiet-secondary" size="inline" onClick={() => onCopy(draft.sessionId)}>
                复制文本
              </WebuiButton>
              <WebuiButton variant="quiet-secondary" size="inline" onClick={() => {
                try {
                  onTransfer(draft.sessionId);
                  setTransferError(undefined);
                } catch (error: unknown) {
                  setTransferError({ sessionId: draft.sessionId, message: error instanceof Error ? error.message : String(error) });
                }
              }}>
                合并到当前任务
              </WebuiButton>
              <WebuiButton variant="danger" size="inline" onClick={() => onDiscard(draft.sessionId)}>
                丢弃
              </WebuiButton>
            </WebuiInline>
            {transferError?.sessionId === draft.sessionId ? (
              <FeedbackError message={`无法合并保留内容：${transferError.message}`} testId="external-deletion-transfer-error" />
            ) : null}
          </div>
        );
      })}
    </FeedbackLiveRegion>
  );
}
