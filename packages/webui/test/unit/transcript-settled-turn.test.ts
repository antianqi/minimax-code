// The settle comparison: a settled turn may only be replaced by a page that is
// at least as complete as the live view was.
//
// This is the pure half of the bug where the reply's file row and picture
// appeared and then vanished a moment later: the persisted page carried the
// text first and the delivered file second, and a page that merely *had* the
// message was accepted.
import { describe, expect, it } from "vitest";

import {
  isWebuiSettledTurnCaughtUp,
  projectWebuiSettledTurnShape,
} from "../../src/client/features/transcript/projection/settled-turn.js";

const FLOWER = '<deliver-assets><media src="/synthetic/workspace/flower.svg" name="极简 SVG 花朵" /></deliver-assets>';

function live(msgId: string, msgContent: string) {
  return projectWebuiSettledTurnShape({ msgId, msgContent });
}

describe("projectWebuiSettledTurnShape", () => {
  it("counts prose and delivered files separately", () => {
    expect(live("m-live", `画好了，见附件。\n\n${FLOWER}`)).toEqual({ msgId: "m-live", textLength: 8, assets: 1 });
  });

  it("does not count the delivered markup as prose", () => {
    // The renderer lifts the container out, so its characters must not make a
    // text-only page look caught up.
    const withFile = live("m", `${FLOWER}画好了`);
    const proseOnly = live("m", "画好了");
    expect(withFile.textLength).toBe(proseOnly.textLength);
    expect(withFile.assets).toBe(1);
    expect(proseOnly.assets).toBe(0);
  });

  it("keeps a generated image link in the live message shape", () => {
    const linked = live("m-markdown-image", "花朵已生成。\n\n- [flower.svg — 极简五瓣花](flower.svg)");
    const proseOnly = live("m-markdown-image", "花朵已生成。");
    expect(linked.assets).toBe(0);
    expect(linked.textLength).toBeGreaterThan(proseOnly.textLength);
  });
});

describe("isWebuiSettledTurnCaughtUp", () => {
  it("rejects a page whose message is still being written", () => {
    // The reported shape: the text is persisted, the delivered file is not yet.
    const expected = [live("m-two-step", `画好了，见附件。\n\n${FLOWER}`)];
    expect(isWebuiSettledTurnCaughtUp(expected, [{ msgId: "m-two-step", msgContent: "画好了，见附件。" }])).toBe(false);
  });

  it("accepts the page once the delivered file lands with it", () => {
    const expected = [live("m-two-step", `画好了，见附件。\n\n${FLOWER}`)];
    expect(
      isWebuiSettledTurnCaughtUp(expected, [{ msgId: "m-two-step", msgContent: `画好了，见附件。\n\n${FLOWER}` }]),
    ).toBe(true);
  });

  it("rejects a persisted reply that has prose but not its Markdown image link", () => {
    const expected = [live("m-markdown-image", "花朵已生成。\n\n- [flower.svg — 极简五瓣花](flower.svg)")];
    expect(isWebuiSettledTurnCaughtUp(expected, [{ msgId: "m-markdown-image", msgContent: "花朵已生成。" }])).toBe(false);
  });

  it("rejects a page that does not carry the turn at all", () => {
    const expected = [live("m-live", "画好了")];
    expect(isWebuiSettledTurnCaughtUp(expected, [{ msgId: "history-A", msgContent: "older" }])).toBe(false);
  });

  it("rejects a page whose copy of the reply is shorter than what was shown", () => {
    const expected = [live("m-live", "画好了，见附件，这朵花有茎和叶子。")];
    expect(isWebuiSettledTurnCaughtUp(expected, [{ msgId: "m-live", msgContent: "画好了" }])).toBe(false);
  });

  it("accepts a page that carries more than was shown", () => {
    // A later read may hold a further message or a longer tail; that is the
    // page catching up, never a reason to read again.
    const expected = [live("m-live", "画好了")];
    expect(
      isWebuiSettledTurnCaughtUp(expected, [
        { msgId: "m-live", msgContent: "画好了，另外附上一张图。" },
        { msgId: "m-later", msgContent: "补充一句" },
      ]),
    ).toBe(true);
  });

  it("accepts anything when the turn showed nothing", () => {
    expect(isWebuiSettledTurnCaughtUp([], [])).toBe(true);
  });
});
