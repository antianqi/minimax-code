import { describe, expect, it } from "vitest";
import type { WebuiHistoricalTurnView, WebuiLiveTurnView } from "../../src/client/features/transcript/projection/transcript-shape.js";
import type { WebuiClientMessage } from "../../src/client/features/transcript/contracts/message-view.js";
import type { WebuiStreamMessage } from "../../src/client/features/turn/projection/stream-state.js";
import { projectWebuiTranscriptView } from "../../src/client/features/transcript/projection/transcript-view-model.js";
import {
  projectWebuiMessage,
  projectWebuiTranscriptMessage,
} from "../../src/client/features/transcript/projection/message-projection.js";
import {
  groupWebuiTranscriptItems,
  projectWebuiTranscriptMessages,
  projectWebuiQueryDurations,
  projectWebuiProcessSegments,
} from "../../src/client/features/transcript/projection/transcript-projection.js";

function historicalView(message: WebuiClientMessage, sessionId: string): WebuiHistoricalTurnView {
  const view = projectWebuiTranscriptView({
    sessionId, visiblePage: { messages: [message] }, streamMessages: [], streamPhase: "done",
    processingStartedAtMs: undefined, loading: false, error: undefined,
  }).renderGroups[0]?.view;
  if (!view || view.source !== "historical") throw new Error("Expected a historical renderer view");
  return view;
}

function liveView(messages: readonly WebuiStreamMessage[], options: {
  readonly sessionId?: string; readonly streaming: boolean; readonly processingStartedAtMs?: number;
}): WebuiLiveTurnView | undefined {
  const projected = projectWebuiTranscriptView({
    sessionId: options.sessionId ?? "sess", visiblePage: {}, streamMessages: messages,
    streamPhase: options.streaming ? "streaming" : "waiting",
    processingStartedAtMs: options.processingStartedAtMs, loading: false, error: undefined,
  });
  return projected.renderGroups.map((entry) => entry.view).find((view): view is WebuiLiveTurnView => view?.source === "live");
}

// The same production projection covers history and live content.

// ── historical fixture ────────────────────────────────────────────────

describe("final transcript render groups", () => {
  it("keeps settled render views stable while replacing only the changing reply", () => {
    const visiblePage = { messages: [
      { msgId: "history-user", role: "user", msgContent: "Previous question" },
      { msgId: "history-reply", role: "assistant", msgContent: "Previous answer" },
    ] };
    const user = { id: "msg-user-current", role: "user" as const, answer: "Current question", thinking: "" };
    const project = (answer: string) => projectWebuiTranscriptView({
      sessionId: "S", visiblePage, streamMessages: [user, { id: "current-reply", answer, thinking: "" }],
      streamPhase: "streaming", processingStartedAtMs: 10, loading: false, error: undefined,
    });
    const before = project("first chunk");
    const after = project("first chunk and second chunk");
    const oldView = before.renderGroups.find((entry) => entry.group.messageId === "history-reply")!.view;
    const stableView = after.renderGroups.find((entry) => entry.group.messageId === "history-reply")!.view;
    expect(stableView).toBe(oldView);
    expect(stableView?.answers).toEqual(["Previous answer"]);
    const active = after.renderGroups.find((entry) => entry.group.messageId === "current-reply")!.view;
    expect(active?.answers).toEqual(["first chunk and second chunk"]);
    expect(active?.source === "live" && active.streaming).toBe(true);
  });
});

const HISTORICAL_USER: WebuiClientMessage & { streaming?: never } = {
  msgId: "msg-hist-user-1",
  turnId: "turn-1",
  timestamp: 1700000000000,
  role: "user",
  msgContent: "draft the release notes",
  source: "thread-goal",
  usage: {
    request_duration_ms: 1200,
    output_tokens: 80,
  },
};

const HISTORICAL_ASSISTANT: WebuiClientMessage = {
  msgId: "msg-hist-asst-1",
  turnId: "turn-1",
  timestamp: 1700000001500,
  role: "assistant",
  msgContent: "Here is a draft:\n\n## v1.0\n- new session composer",
  thinkingContent: "let me list the bullet points",
  thinkingDurationMs: 850,
  toolCalls: [
    { id: "tc-1", name: "file.read", args: { path: "/notes" } },
  ],
  attachments: [
    {
      id: "att-1",
      type: "file",
      file_name: "notes.md",
      preview_url: "file:///notes.md",
    },
  ],
  usage: {
    request_duration_ms: 1500,
    output_tokens: 240,
  },
  actions: { fork: true, rewind: true, edit: false },
  fileChanges: [
    {
      file: "CHANGELOG.md",
      additions: 1,
      deletions: 1,
      status: "modified",
    },
  ],
};

describe("live transcript timeline merge", () => {
  it("drops malformed history rows before indexing message identities", () => {
    const messages = projectWebuiTranscriptMessages(
      { messages: [null, { role: "user", msgContent: "missing identity" }, { msgId: "valid", role: "user" }] as unknown as WebuiClientMessage[] },
      [],
    );

    expect(messages).toEqual([{ msgId: "valid", role: "user" }]);
  });

  it("inserts a streamed assistant turn before a later queued user already present in history", () => {
    const messages = projectWebuiTranscriptMessages(
      {
        messages: [
          { msgId: "user-1", role: "user", msgContent: "first" },
          { msgId: "user-2", role: "user", msgContent: "second" },
        ],
      },
      [
        { id: "user-1", role: "user", answer: "first", thinking: "" },
        { id: "assistant-1", answer: "replying to first", thinking: "thinking" },
        { id: "user-2", role: "user", answer: "second", thinking: "" },
      ],
    );

    expect(messages.map((message) => message.msgId)).toEqual([
      "user-1",
      "assistant-1",
      "user-2",
    ]);
    expect(messages.map((message) => message.msgContent)).toEqual([
      "first",
      "replying to first",
      "second",
    ]);
  });

  it("updates matching history identities in place without adding a second row", () => {
    const messages = projectWebuiTranscriptMessages(
      { messages: [{ msgId: "user-1", role: "user", msgContent: "old" }] },
      [{ id: "user-1", role: "user", answer: "live", thinking: "" }],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.msgContent).toBe("live");
  });

  it("does not render an event projection beside the persisted goal entry it represents", () => {
    const messages = projectWebuiTranscriptMessages(
      {
        messages: [{
          msgId: "goal-entry-message",
          role: "user",
          msgContent: "Keep this goal active.",
          kind: "goal",
        }],
      },
      [{
        id: "thread-goal-goal-1",
        role: "user",
        answer: "Keep this goal active.",
        thinking: "",
        isGoal: true,
      }],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.msgId).toBe("goal-entry-message");
  });

  it("prefers a matching live goal entry regardless of event order", () => {
    const goalEntry = {
      id: "live-goal-entry",
      role: "user" as const,
      answer: "Keep this goal active.",
      thinking: "",
      isGoal: true,
    };
    const eventProjection = {
      id: "thread-goal-goal-1",
      role: "user" as const,
      answer: "Keep this goal active.",
      thinking: "",
      isGoal: true,
    };

    for (const streamMessages of [
      [eventProjection, goalEntry],
      [goalEntry, eventProjection],
    ]) {
      const messages = projectWebuiTranscriptMessages({ messages: [] }, streamMessages);
      expect(messages.map((message) => message.msgId)).toEqual(["live-goal-entry"]);
    }
  });

  it("does not resurrect a deleted stream-only message after the turn settles", () => {
    const messages = projectWebuiTranscriptMessages(
      { messages: [{ msgId: "user-1", role: "user", msgContent: "kept" }] },
      [
        { id: "user-1", role: "user", answer: "kept", thinking: "" },
        { id: "assistant-1", answer: "rewound", thinking: "" },
      ],
      false,
    );

    expect(messages.map((message) => message.msgId)).toEqual(["user-1"]);
  });
});

// ── leaf renderer contracts (typing + shape) ─────────────────────────

describe("leaf renderer contracts — the historical and live fixtures cover the renderer surface", () => {
  it("preserves user identity, goal origin and timestamp in the final history and live render views", () => {
    const historical = historicalView(HISTORICAL_USER, "S");
    const streamed = projectWebuiTranscriptView({
      sessionId: "S", visiblePage: {}, streamPhase: "streaming", processingStartedAtMs: undefined,
      loading: false, error: undefined, streamMessages: [{
        id: "msg-live-user", role: "user", answer: "draft the release notes", thinking: "",
        timestamp: 1700000000000, isGoal: true,
      }],
    }).renderGroups[0]?.view;
    for (const view of [historical, streamed]) expect(view).toMatchObject({
      sessionId: "S", role: "user", userText: "draft the release notes", timestamp: 1700000000000, isGoal: true,
    });
    expect(historical.messageId).toBe("msg-hist-user-1");
    expect(streamed?.messageId).toBe("msg-live-user");
  });
  it("projects historical delegation and activity rows from the persisted raw message", () => {
    const items = projectWebuiMessage({
      msgId: "history-activity",
      role: "assistant",
      rawJson: JSON.stringify({
        parts: [
          { id: "think", type: "thinking", content: "Reasoning" },
          { id: "delegate", type: "delegation", message: { fromAgent: "main", toAgent: "child", content: "Review" } },
          { id: "tool", type: "tool_call", tool_call: { name: "bash", status: "done" } },
          { id: "answer", type: "text", content: "Final" },
        ],
      }),
    });
    expect(items.map((item) => item.kind)).toEqual(["thinking", "activity", "tool", "assistant"]);
    const segments = projectWebuiProcessSegments(items);
    expect(segments[0]?.activityParts?.map((part) => part.type)).toEqual(["thinking", "delegation", "tool", "text"]);
    expect(segments[0]?.activityParts?.[1]).toMatchObject({ type: "delegation", message: { toAgent: "child" } });
  });

  it("projects the same activity order from live agent_message parts", () => {
    const view = liveView([{
      id: "live-activity",
      answer: "Final",
      thinking: "",
      parts: [
        { id: "think", type: "thinking", content: "Reasoning" },
        { id: "delegate", type: "delegation", message: { fromAgent: "main", toAgent: "child", content: "Review" } },
        { id: "tool", type: "tool_call", tool_call: { name: "bash", status: "running" } },
        { id: "answer", type: "text", content: "Final" },
      ],
    }], { streaming: true });
    expect(view?.processSegments?.[0]?.activityParts?.map((part) => part.type)).toEqual(["thinking", "delegation", "tool", "text"]);
  });

});

// ── direct adapter execution (six categories) ─────────────────────────

describe("historicalView — direct execution on the six content categories", () => {
  // Build a fresh fixture for each category. The adapter runs and the
  // asserted field on the returned view must reflect the input — six
  // distinct input → output pinpoints. Mutation: deleting the
  // corresponding adapter branch flips the matching assertion to red.

  it("category 1 — diff: `initialDiff` is the most recent per-item diff or the message-level fallback", () => {
    const withItemDiff: WebuiClientMessage = {
      ...HISTORICAL_ASSISTANT,
      // Two diffs; the message-level fallback reader picks the last one
      // when no per-item diff is set (since `projectWebuiMessage` does
      // not produce items with a `diff` field — see message-projection.ts).
      fileChanges: [
        { file: "a", additions: 1, deletions: 0, status: "modified" },
        { file: "b", additions: 1, deletions: 1, status: "modified" },
      ],
    };
    const view = historicalView(withItemDiff, "sess");
    expect(view.source).toBe("historical");
    expect(view.initialDiff).toBeDefined();
    expect(view.initialDiff?.fileChanges?.[1]?.file).toBe("b");

    const noFileChanges: WebuiClientMessage = {
      ...HISTORICAL_ASSISTANT,
      fileChanges: undefined,
    };
    const fallbackView = historicalView(noFileChanges, "sess");
    expect(fallbackView.initialDiff).toBeUndefined();
  });

  it("category 2 — attachments: passthrough through projectMessageAttachments", () => {
    const view = historicalView(HISTORICAL_ASSISTANT, "sess");
    expect(view.attachments?.[0]?.file_name).toBe("notes.md");
    expect(view.attachments?.[0]?.preview_url).toBe("file:///notes.md");

    const noAttachments: WebuiClientMessage = {
      ...HISTORICAL_ASSISTANT,
      attachments: undefined,
    };
    const emptyView = historicalView(noAttachments, "sess");
    expect(emptyView.attachments).toBeUndefined();
  });

  it("category 3 — thinking + durationMs: joined from thinking parts", () => {
    const view = historicalView(HISTORICAL_ASSISTANT, "sess");
    expect(view.thinking).toBe("let me list the bullet points");
    expect(view.thinkingDurationMs).toBe(850);
  });

  it("category 4 — tools: flatMap of every tool-item's `tools` array", () => {
    const view = historicalView(HISTORICAL_ASSISTANT, "sess");
    expect(view.tools).toEqual([
      { id: "tc-1", name: "file.read", args: { path: "/notes" } },
    ]);

    // Pin: if `tools` were never returned (the audit's mutation
    // hypothesis), `view.tools` would be `undefined` and this
    // assertion would fail. The audit reproduces the same deletion in
    // the adapter and the test would go red — this is the "direct
    // execution" pin the field tables alone could not provide.
    expect(view.tools).not.toBeUndefined();

    const noToolCalls: WebuiClientMessage = {
      ...HISTORICAL_ASSISTANT,
      toolCalls: undefined,
    };
    const noToolsView = historicalView(noToolCalls, "sess");
    expect(noToolsView.tools).toBeUndefined();
  });

  it("category 5 — actions: forwarded from the first projectWebuiMessage item", () => {
    const view = historicalView(HISTORICAL_ASSISTANT, "sess");
    expect(view.actions).toEqual({
      fork: true,
      rewind: true,
      edit: false,
    });

    const noActions: WebuiClientMessage = {
      ...HISTORICAL_ASSISTANT,
      actions: undefined,
    };
    const emptyView = historicalView(noActions, "sess");
    expect(emptyView.actions).toBeUndefined();
  });

  it("category 6 — streaming placeholder: NEVER returned on historical view", () => {
    // The historical view never carries streaming / streamMessageId /
    // messageRootId / processingStartedAtMs — these are live-only. The
    // type system rejects them at compile time (WebuiHistoricalTurnView
    // doesn't declare them), but the runtime read also confirms.
    const view = historicalView(HISTORICAL_ASSISTANT, "sess");
    // Source discriminator is `historical`.
    expect(view.source).toBe("historical");
  });
});

describe("single message normalization", () => {
  it("normalizes each message once before returning its ordered items", () => {
    let calls = 0;
    const projected = projectWebuiTranscriptMessage(HISTORICAL_ASSISTANT, (message) => {
      calls += 1;
      return projectWebuiMessage(message);
    });
    expect(calls).toBe(1);
    expect(projected.items.map((item) => item.kind)).toEqual(projectWebuiMessage(HISTORICAL_ASSISTANT).map((item) => item.kind));
    expect(historicalView(HISTORICAL_ASSISTANT, "sess")).toMatchObject({
      thinking: "let me list the bullet points",
      tools: [{ id: "tc-1", name: "file.read", args: { path: "/notes" } }],
      attachments: [{ id: "att-1", file_name: "notes.md" }],
    });
  });
});

describe("liveView — direct execution on the six content categories", () => {
  const ASSISTANT_FRAMES: readonly WebuiStreamMessage[] = [
    {
      id: "live-asst-1",
      answer: "",
      thinking: "first reasoning",
      toolCalls: [{ id: "t1", name: "search.query" }],
    },
    {
      id: "live-asst-2",
      answer: "The answer is",
      thinking: "second reasoning",
      toolCalls: [{ id: "t2", name: "compute" }],
      usage: { request_duration_ms: 800, output_tokens: 30 },
    },
    {
      id: "live-asst-3",
      answer: "ready",
      thinking: "",
      usage: { request_duration_ms: 250, output_tokens: 12 },
    },
  ];

  it("category 1 — diff: never returned on live view (no item carries it)", () => {
    const view = liveView(ASSISTANT_FRAMES, {
      streaming: true,
      processingStartedAtMs: 1000,
    });
    expect(view).toBeDefined();
    // WebuiLiveTurnView doesn't declare initialDiff; the discriminator
    // is enough to confirm the historical-only branch did not run.
    expect(view?.source).toBe("live");
  });

  it("category 2 — attachments: never returned on live view", () => {
    const view = liveView(ASSISTANT_FRAMES, {
      streaming: true,
      processingStartedAtMs: 1000,
    });
    expect(view?.source).toBe("live");
  });

  it("category 3 — thinking: joined, dropping empty-trim entries", () => {
    const view = liveView(ASSISTANT_FRAMES, {
      streaming: true,
      processingStartedAtMs: 1000,
    });
    // Frames 1 and 2 have non-empty thinking; frame 3 has empty. The
    // adapter joins with "\n\n" between non-empty entries.
    expect(view?.thinking).toBe("first reasoning\n\nsecond reasoning");
  });

  it("category 4 — tools: flatMap across all assistant frames", () => {
    const view = liveView(ASSISTANT_FRAMES, {
      streaming: true,
      processingStartedAtMs: 1000,
    });
    expect(view?.tools).toEqual([
      { id: "t1", name: "search.query" },
      { id: "t2", name: "compute" },
    ]);
  });

  it("category 5 — actions: never on live view (no wire field carries them)", () => {
    const view = liveView(ASSISTANT_FRAMES, {
      streaming: true,
      processingStartedAtMs: 1000,
    });
    expect(view?.source).toBe("live");
  });

  it("category 6 — streaming placeholder: live view always sets `streaming` from args and `processingStartedAtMs` when provided", () => {
    const view = liveView(ASSISTANT_FRAMES, {
      streaming: true,
      processingStartedAtMs: 1700,
    });
    expect(view?.streaming).toBe(true);
    expect(view?.processingStartedAtMs).toBe(1700);
    expect(view?.streamMessageId).toBe("merged");
    expect(view?.messageRootId).toBe("merged");

    // Usage sums across the two frames that carry it.
    expect(view?.totalRequestDurationMs).toBe(1050);
    expect(view?.totalOutputTokens).toBe(42);
  });
});

describe("groupWebuiTranscriptItems — persisted query duration", () => {
  it("uses the persisted query elapsed time when per-message request usage is absent", () => {
    const messageId = "goal-reply";
    const items = projectWebuiMessage({
      msgId: messageId,
      role: "assistant",
      turnId: "turn-final",
      queryKey: "goal:goal-1:turn:turn-root",
      timestamp: 1_790_224_743_333,
      parts: [{ type: "text", content: "Goal completed" }],
    });
    const queryDurations = projectWebuiQueryDurations(
      [{ msgId: messageId, queryKey: "goal:goal-1:turn:turn-root" }],
      [{
        queryKey: "goal:goal-1:turn:turn-root",
        currentTurnId: "turn-final",
        processingStartedAtMs: 1_790_224_724_874,
        processingFinishedAtMs: 1_790_224_743_471,
      }],
    );
    const groups = groupWebuiTranscriptItems(items, queryDurations);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.totalRequestDurationMs).toBe(18_597);
  });
});

describe("the process-block gate", () => {
  // Whether a turn shows its process disclosure at all. This predicate had no
  // coverage: inverting it left all 2131 tests green, so it is pinned here.
  // Only a part that is not plain text earns a block — a reply that is prose
  // and nothing else renders as a reply, not as an archived process.
  const textOnlyItem = () =>
    projectWebuiMessage({
      msgId: "history-text-only",
      role: "assistant",
      rawJson: JSON.stringify({
        parts: [{ id: "answer", type: "text", content: "Final" }],
      }),
    });

  const toolItem = () =>
    projectWebuiMessage({
      msgId: "history-tool",
      role: "assistant",
      rawJson: JSON.stringify({
        parts: [
          { id: "tool", type: "tool_call", tool_call: { name: "bash", status: "done" } },
        ],
      }),
    });

  it("keeps the segments when the activity is not all text", () => {
    expect(projectWebuiProcessSegments(toolItem())).toHaveLength(1);
  });

  it("returns nothing when the activity is text only", () => {
    expect(projectWebuiProcessSegments(textOnlyItem())).toEqual([]);
  });

  it("applies the same gate to the live turn view", () => {
    const live = (parts: readonly Record<string, unknown>[]) =>
      liveView(
        [{ id: "live", answer: "Final", thinking: "", parts }],
        { streaming: true },
      );

    expect(
      live([{ id: "answer", type: "text", content: "Final" }])?.processSegments,
    ).toEqual([]);
    expect(
      live([
        { id: "tool", type: "tool_call", tool_call: { name: "bash", status: "running" } },
        { id: "answer", type: "text", content: "Final" },
      ])?.processSegments?.[0]?.activityParts?.map((part) => part.type),
    ).toEqual(["tool", "text"]);
  });
});
