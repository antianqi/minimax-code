import { describe, expect, it } from "vitest";
import {
  WEBUI_SCROLL_EDGE_THRESHOLD_PX,
  WEBUI_SCROLL_END_THRESHOLD_PX,
  webuiScrollAtEnd,
  webuiScrollBottomTop,
  webuiScrollFollowsAgain,
  webuiScrollIntent,
  webuiScrollMovedTowardEnd,
} from "../../src/client/features/transcript/projection/transcript-scroll.js";

describe("transcript scroll geometry", () => {
  it("pins the viewport to the last message", () => {
    expect(
      webuiScrollBottomTop({ scrollTop: 0, scrollHeight: 4200, clientHeight: 800 }),
    ).toBe(3400);
  });

  it("clamps to the top when the transcript is shorter than the viewport", () => {
    expect(
      webuiScrollBottomTop({ scrollTop: 0, scrollHeight: 500, clientHeight: 800 }),
    ).toBe(0);
  });

  it("treats the very end as the end, and nothing above it", () => {
    const bottom = webuiScrollBottomTop({
      scrollTop: 0,
      scrollHeight: 4200,
      clientHeight: 800,
    });
    expect(
      webuiScrollAtEnd({
        scrollTop: bottom,
        scrollHeight: 4200,
        clientHeight: 800,
      }),
    ).toBe(true);
    expect(
      webuiScrollAtEnd({
        scrollTop: bottom - WEBUI_SCROLL_END_THRESHOLD_PX,
        scrollHeight: 4200,
        clientHeight: 800,
      }),
    ).toBe(true);
    expect(
      webuiScrollAtEnd({
        scrollTop: bottom - WEBUI_SCROLL_END_THRESHOLD_PX - 1,
        scrollHeight: 4200,
        clientHeight: 800,
      }),
    ).toBe(false);
  });

  it("reads an unfilled viewport as at the end so an empty session never unfollows", () => {
    expect(
      webuiScrollAtEnd({ scrollTop: 0, scrollHeight: 120, clientHeight: 800 }),
    ).toBe(true);
  });
});

/**
 * When the follower follows again after a gesture released it.
 *
 * The reader has to walk back to the end by themselves. The gesture's own
 * scroll event is not that walk: it moves away from the end, and the browser
 * delivers it after the pin has already dragged the viewport back down.
 */
describe("when the transcript follows again", () => {
  const TALL = { scrollHeight: 4200, clientHeight: 800 };
  const bottom = webuiScrollBottomTop({ scrollTop: 0, ...TALL });

  it("reads the direction of a scroll from the two positions it moved between", () => {
    expect(webuiScrollMovedTowardEnd(1848, 1849)).toBe(true);
    expect(webuiScrollMovedTowardEnd(1848, 1848)).toBe(false);
    expect(webuiScrollMovedTowardEnd(1848, 1728)).toBe(false);
  });

  it("follows again once the reader walked back to the end", () => {
    expect(
      webuiScrollFollowsAgain({
        metrics: { scrollTop: bottom, ...TALL },
        movedTowardEnd: true,
      }),
    ).toBe(true);
  });

  it("does not follow again while the reader is still away from the end", () => {
    expect(
      webuiScrollFollowsAgain({
        metrics: { scrollTop: bottom - 200, ...TALL },
        movedTowardEnd: true,
      }),
    ).toBe(false);
  });

  it("does not follow again on a scroll that walked away from the end", () => {
    expect(
      webuiScrollFollowsAgain({
        metrics: { scrollTop: bottom, ...TALL },
        movedTowardEnd: false,
      }),
    ).toBe(false);
  });
});

/**
 * Which gestures count as the user taking the viewport away from the newest
 * content. The rules are the message viewport's: a gesture the viewport
 * cannot answer is not an intent.
 *
 * This layer is the only one of the follower that a test can reach: it lives in a
 * component effect, and this package's Vitest environment is `node` — no jsdom,
 * so effects never run. The wiring is named as an untested boundary in the
 * report instead of being covered by an assertion that would pass either way.
 */
describe("which gestures release the transcript's follow", () => {
  const TALL = { scrollHeight: 4200, clientHeight: 800 };
  const bottom = webuiScrollBottomTop({ scrollTop: 0, ...TALL });

  it("releases on a wheel that can move the viewport", () => {
    expect(webuiScrollIntent({ event: "wheel", deltaY: -120, metrics: { scrollTop: 2000, ...TALL } })).toBe("release");
    expect(webuiScrollIntent({ event: "wheel", deltaY: 120, metrics: { scrollTop: 2000, ...TALL } })).toBe("release");
  });

  it("ignores a wheel that pushes further down while the viewport is already at the bottom", () => {
    // The case a second follower used to get wrong: at the bottom, a further
    // downward wheel has nowhere to go, so it is recorded as
    // `wheel-intent:ignored-boundary` and keeps following. Reading it as "the
    // user has taken over" is what left later content below the fold.
    expect(webuiScrollIntent({ event: "wheel", deltaY: 120, metrics: { scrollTop: bottom, ...TALL } })).toBe("ignore");
    expect(webuiScrollIntent({ event: "wheel", deltaY: 120, metrics: { scrollTop: bottom - 10, ...TALL } })).toBe("ignore");
  });

  it("ignores a wheel that pushes further up while the viewport is already at the top", () => {
    expect(webuiScrollIntent({ event: "wheel", deltaY: -120, metrics: { scrollTop: 0, ...TALL } })).toBe("ignore");
    expect(webuiScrollIntent({ event: "wheel", deltaY: -120, metrics: { scrollTop: 12, ...TALL } })).toBe("ignore");
  });

  it("still releases when the wheel moves away from the edge it sits on", () => {
    // Sitting at the bottom and scrolling up is the user leaving the newest
    // content behind; sitting at the top and scrolling down is the opposite.
    expect(webuiScrollIntent({ event: "wheel", deltaY: -120, metrics: { scrollTop: bottom, ...TALL } })).toBe("release");
    expect(webuiScrollIntent({ event: "wheel", deltaY: 120, metrics: { scrollTop: 0, ...TALL } })).toBe("release");
  });

  it("does not treat a resting finger as a scroll", () => {
    expect(webuiScrollIntent({ event: "touchmove", deltaY: 3, metrics: { scrollTop: 2000, ...TALL } })).toBe("ignore");
    expect(webuiScrollIntent({ event: "touchmove", deltaY: -7, metrics: { scrollTop: 2000, ...TALL } })).toBe("ignore");
    expect(webuiScrollIntent({ event: "touchmove", deltaY: -40, metrics: { scrollTop: 2000, ...TALL } })).toBe("release");
  });

  it("uses the edge band for gestures, not the narrow band that counts as the end", () => {
    // Being near the end does not put the viewport at an edge: a downward wheel
    // there still moves, so it still counts.
    expect(WEBUI_SCROLL_EDGE_THRESHOLD_PX).toBeGreaterThan(WEBUI_SCROLL_END_THRESHOLD_PX);
    expect(
      webuiScrollIntent({
        event: "wheel",
        deltaY: 120,
        metrics: { scrollTop: bottom - WEBUI_SCROLL_EDGE_THRESHOLD_PX - 1, ...TALL },
      }),
    ).toBe("release");
  });
});
