// The observation an `agent.observe` call opens.
//
// One seam: `publish` in, `onEvent` out. A page asks to watch every conversation or one
// conversation, gets events until it cancels or aborts, and never learns anything the
// event does not carry. What this file does not do is decide *when* a turn ended — it
// carries the fact the turn system publishes, so the same shape reaches a page whoever
// started the turn.
//
// Three rules the tests pin:
//
//   * **A subscription ends when it is cancelled or aborted**, and ends once: the promise
//     a page awaits settles, and nothing arrives after it.
//   * **Two subscriptions never share a request id.** The id is the handle a page cancels
//     with, so a duplicate is `busy` rather than a silent replacement of somebody else's
//     watch.
//   * **One listener throwing is that listener's problem.** A page that breaks its own
//     handler does not stop the other pages watching the same conversation.

import { describe, expect, it } from "vitest";

import { createMiniAppAgentObservations } from "../../../src/service/miniapp/agent/observations.js";

const TURN = { sessionId: "s1", turnId: "t1", title: "A conversation", outcome: "finished" };

describe("watching every conversation", () => {
  it("receives the turns the runtime publishes", async () => {
    const observations = createMiniAppAgentObservations();
    const seen: unknown[] = [];
    const done = observations.subscribe(
      { pluginId: "pet", requestId: "r1", all: true },
      { onEvent: (event) => seen.push(event) },
    );

    observations.publish(TURN);

    expect(seen).toEqual([{ type: "turn.finished", ...TURN }]);
    observations.cancel("pet", "r1");
    await done;
  });

  it("stops when cancelled, and the promise a page awaits settles", async () => {
    const observations = createMiniAppAgentObservations();
    const seen: unknown[] = [];
    const done = observations.subscribe(
      { pluginId: "pet", requestId: "r2", all: true },
      { onEvent: (event) => seen.push(event) },
    );

    observations.cancel("pet", "r2");
    await expect(done).resolves.toBeUndefined();

    observations.publish(TURN);
    expect(seen).toEqual([]);
  });

  it("ends when the page that opened it goes away", async () => {
    const observations = createMiniAppAgentObservations();
    const controller = new AbortController();
    const seen: unknown[] = [];
    const done = observations.subscribe(
      { pluginId: "pet", requestId: "r3", all: true },
      { onEvent: (event) => seen.push(event), signal: controller.signal },
    );

    controller.abort();
    await expect(done).resolves.toBeUndefined();

    observations.publish(TURN);
    expect(seen).toEqual([]);
  });
});

describe("watching one conversation", () => {
  it("ignores turns from another conversation", () => {
    const observations = createMiniAppAgentObservations();
    const seen: unknown[] = [];
    const done = observations.subscribe(
      { pluginId: "pet", requestId: "r4", sessionId: "s1" },
      { onEvent: (event) => seen.push(event) },
    );

    observations.publish(TURN);
    observations.publish({ ...TURN, sessionId: "s2" });

    expect(seen).toHaveLength(1);
    observations.cancel("pet", "r4");
    void done;
  });
});

describe("more than one caller", () => {
  it("refuses a request id another watch already holds", () => {
    const observations = createMiniAppAgentObservations();
    const first = observations.subscribe(
      { pluginId: "pet", requestId: "r5", all: true },
      { onEvent: () => undefined },
    );

    expect(() =>
      observations.subscribe({ pluginId: "other", requestId: "r5", all: true }, { onEvent: () => undefined }),
    ).toThrow(/busy/);

    observations.cancel("pet", "r5");
    void first;
  });

  it("keeps watching for the others when one listener throws", () => {
    const observations = createMiniAppAgentObservations();
    const seen: unknown[] = [];
    const broken = observations.subscribe(
      { pluginId: "pet", requestId: "r6", all: true },
      { onEvent: () => { throw new Error("page bug"); } },
    );
    const sound = observations.subscribe(
      { pluginId: "kid", requestId: "r7", all: true },
      { onEvent: (event) => seen.push(event) },
    );

    expect(() => observations.publish(TURN)).not.toThrow();
    expect(seen).toHaveLength(1);

    observations.cancel("pet", "r6");
    observations.cancel("kid", "r7");
    void broken;
    void sound;
  });
});
