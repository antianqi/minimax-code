// Final renderer contracts. Both history and live content are projected by
// transcript-view-model.ts through the same ordered-message/group pipeline.
import type { WebuiMessageAttachment, WebuiQueueSend } from "../contracts/message-view.js";
import type { WebuiTranscriptProcessSegment, WebuiMessageActionCapabilities } from "../contracts/transcript-view.js";
import type { WebuiTurnDiffView } from "../../../../shared/contracts/session.js";

export interface WebuiTurnViewBase {
  readonly renderKey?: string;
  readonly queueSend?: WebuiQueueSend;
  readonly source: "historical" | "live";
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly sessionId?: string;
  readonly userText?: string;
  readonly thinking?: string;
  readonly tools?: readonly Record<string, unknown>[];
  readonly answers?: readonly string[];
  readonly timestamp?: number;
  readonly isGoal?: boolean;
  readonly totalRequestDurationMs?: number;
  readonly totalOutputTokens?: number;
  /** Live adapter or historical assistant-group projector. */
  readonly processSegments?: readonly WebuiTranscriptProcessSegment[];
}

/**
 * Historical-only extension: persisted fields the live path never carries.
 * `source: "historical"` narrows the union for `MessageItem` reads.
 */
export interface WebuiHistoricalTurnView extends WebuiTurnViewBase {
  readonly source: "historical";
  readonly turnId?: string;
  readonly processForceExpanded?: boolean;
  readonly thinkingDurationMs?: number;
  readonly initialDiff?: WebuiTurnDiffView;
  readonly actions?: WebuiMessageActionCapabilities;
  readonly attachments?: readonly WebuiMessageAttachment[];
}

/**
 * Live-only extension: in-flight fields the historical path never carries.
 * `source: "live"` narrows the union for `MessageItem` reads.
 */
export interface WebuiLiveTurnView extends WebuiTurnViewBase {
  readonly source: "live";
  readonly assistantMessageId?: string;
  readonly streaming?: boolean;
  readonly streamMessageId?: string;
  readonly messageRootId?: string;
  readonly processingStartedAtMs?: number;
}

/**
 * Discriminated union the leaf renderer accepts. Access to side-specific
 * fields (`initialDiff`, `streaming`, …) requires narrowing on `source`.
 */
export type WebuiTurnView = WebuiHistoricalTurnView | WebuiLiveTurnView;
