// The settle comparison: a settled turn may only be replaced by a page that is
// at least as complete as the live view was.
//
// This is the pure half of the bug where the reply's file row and picture
// appeared and then vanished a moment later: the persisted page carried the
// text first and the delivered file second, and a page that merely *had* the
// message was accepted.
import { describe, expect, it } from "vitest";

import {
  isWebuiObservedMessagePersisted,
} from "../../src/client/features/transcript/projection/settled-turn.js";

const FLOWER = '<deliver-assets><media src="/synthetic/workspace/flower.svg" name="极简 SVG 花朵" /></deliver-assets>';

describe("observed content evidence", () => {
  it("accepts a completed tool without mistaking its earlier running state for missing content", () => {
    const observed = { id: "tool-message", answer: "Done", thinking: "", toolCalls: [{ id: "call", name: "bash", status: "running" }] };
    expect(isWebuiObservedMessagePersisted(observed, {
      msgId: "tool-message", msgContent: "Done", toolCalls: [{ id: "call", name: "bash", status: "completed", output: "result" }],
    })).toBe(true);
    expect(isWebuiObservedMessagePersisted(observed, {
      msgId: "tool-message", msgContent: "Done", toolCalls: [{ id: "different-call", name: "bash", status: "completed" }],
    })).toBe(false);
  });
  it("rejects equal-length different prose and different assets with equal counts", () => {
    const observed = { id: "m", answer: `AAAA${FLOWER}`, thinking: "" };
    expect(isWebuiObservedMessagePersisted(observed, { msgId: "m", msgContent: `BBBB${FLOWER}` })).toBe(false);
    expect(isWebuiObservedMessagePersisted(observed, { msgId: "m", msgContent: `AAAA${FLOWER.replace("flower.svg", "other.svg")}` })).toBe(false);
    expect(isWebuiObservedMessagePersisted(observed, { msgId: "m", msgContent: `AAAA${FLOWER}` })).toBe(true);
  });
});

function live(msgId: string, msgContent: string) {
  return { id: msgId, answer: msgContent, thinking: "" };
}

describe("observed message persistence", () => {
  it("rejects a page whose message is still being written", () => {
    // The reported shape: the text is persisted, the delivered file is not yet.
    const expected = live("m-two-step", `画好了，见附件。\n\n${FLOWER}`);
    expect(isWebuiObservedMessagePersisted(expected, { msgId: "m-two-step", msgContent: "画好了，见附件。" })).toBe(false);
  });

  it("accepts the page once the delivered file lands with it", () => {
    const expected = live("m-two-step", `画好了，见附件。\n\n${FLOWER}`);
    expect(
      isWebuiObservedMessagePersisted(expected, { msgId: "m-two-step", msgContent: `画好了，见附件。\n\n${FLOWER}` }),
    ).toBe(true);
  });

  it("rejects a persisted reply that has prose but not its Markdown image link", () => {
    const expected = live("m-markdown-image", "花朵已生成。\n\n- [flower.svg — 极简五瓣花](flower.svg)");
    expect(isWebuiObservedMessagePersisted(expected, { msgId: "m-markdown-image", msgContent: "花朵已生成。" })).toBe(false);
  });

  it("rejects a page that does not carry the turn at all", () => {
    const expected = live("m-live", "画好了");
    expect(isWebuiObservedMessagePersisted(expected, { msgId: "history-A", msgContent: "older" })).toBe(false);
  });

  it("rejects a page whose copy of the reply is shorter than what was shown", () => {
    const expected = live("m-live", "画好了，见附件，这朵花有茎和叶子。");
    expect(isWebuiObservedMessagePersisted(expected, { msgId: "m-live", msgContent: "画好了" })).toBe(false);
  });

  it("accepts a page that carries more than was shown", () => {
    // A later read may hold a further message or a longer tail; that is the
    // page catching up, never a reason to read again.
    const expected = live("m-live", "画好了");
    expect(
      isWebuiObservedMessagePersisted(expected, { msgId: "m-live", msgContent: "画好了，另外附上一张图。" }),
    ).toBe(true);
  });

  it("accepts an empty observed message with the same durable identity", () => {
    expect(isWebuiObservedMessagePersisted(live("empty", ""), { msgId: "empty" })).toBe(true);
  });
});
