// The prompt a page's `ask` waits on.
//
// One seam: `createMiniAppToolApprovals()` — the port the gateway's `ask` reaches.
// What it proves: a request becomes one pending item a client can render; an answer
// settles exactly that request; an unanswered prompt ends as a refusal rather than a
// silent allow; an aborted request is `unavailable` (nobody could ask), not a decision;
// and answering an id that is gone changes nothing. What it does not cover: who renders
// the prompt (the client's), and when a request should time out (the caller's).

import { describe, expect, it, vi } from "vitest";

import { createMiniAppToolApprovals } from "../../../src/service/miniapp/tool-approvals.js";

const request = () => ({
  mode: "call" as const,
  pluginId: "pet",
  tools: [{ name: "mcp__files__read", argumentsPreview: "{}" }],
});

describe("the Mini App approval prompt", () => {
  it("publishes one pending item a client can render, and settles it with the answer", async () => {
    const approvals = createMiniAppToolApprovals();
    const seen: Array<readonly { requestId: string; pluginId: string; name: string }[]> = [];
    approvals.subscribe((pending) =>
      seen.push(pending.map((item) => ({
        requestId: item.requestId,
        pluginId: item.pluginId,
        name: item.tools[0]!.name,
      }))),
    );

    const pendingAnswer = approvals.request(request());
    const [pending] = approvals.pending();

    expect(pending).toMatchObject({ pluginId: "pet", mode: "call" });
    expect(seen.at(-1)).toEqual([
      { requestId: pending!.requestId, pluginId: "pet", name: "mcp__files__read" },
    ]);

    expect(approvals.answer({ requestId: pending!.requestId, decision: "allow" })).toBe(true);
    expect(approvals.pending()).toEqual([]);
    await expect(pendingAnswer).resolves.toEqual({ decision: "allow" });
  });

  it("carries the tools the person ticked through an allowAlways answer", async () => {
    const approvals = createMiniAppToolApprovals();
    const pendingAnswer = approvals.request({
      mode: "request",
      pluginId: "pet",
      tools: [{ name: "a" }, { name: "b" }],
    });

    approvals.answer({ requestId: approvals.pending()[0]!.requestId, decision: "allowAlways", names: ["b"] });

    await expect(pendingAnswer).resolves.toEqual({ decision: "allowAlways", names: ["b"] });
  });

  it("ends an unanswered prompt as a refusal, never as a silent allow", async () => {
    vi.useFakeTimers();
    try {
      const approvals = createMiniAppToolApprovals({ timeoutMs: 1_000 });
      const pendingAnswer = approvals.request(request());

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(pendingAnswer).resolves.toEqual({ decision: "deny" });
      expect(approvals.pending()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers unavailable when the request is aborted, because nobody could ask", async () => {
    const approvals = createMiniAppToolApprovals();
    const controller = new AbortController();
    const pendingAnswer = approvals.request({ ...request(), signal: controller.signal });

    controller.abort();

    await expect(pendingAnswer).resolves.toBe("unavailable");
    expect(approvals.pending()).toEqual([]);
  });

  it("answers unavailable immediately for a request that is already aborted", async () => {
    const approvals = createMiniAppToolApprovals();
    const controller = new AbortController();
    controller.abort();

    await expect(approvals.request({ ...request(), signal: controller.signal })).resolves.toBe(
      "unavailable",
    );
    expect(approvals.pending()).toEqual([]);
  });

  it("refuses an answer that names a different plugin than the prompt", async () => {
    const approvals = createMiniAppToolApprovals();
    const pendingAnswer = approvals.request(request());
    const [pending] = approvals.pending();

    // A client that can frame one Mini App must not settle another's prompt.
    expect(
      approvals.answer({
        requestId: pending!.requestId,
        pluginId: "another.app",
        decision: "allow",
      }),
    ).toBe(false);
    expect(approvals.pending()).toHaveLength(1);

    approvals.answer({ requestId: pending!.requestId, pluginId: "pet", decision: "deny" });
    await expect(pendingAnswer).resolves.toEqual({ decision: "deny" });
  });

  it("changes nothing when the id it is handed is already gone", async () => {
    const approvals = createMiniAppToolApprovals();
    const pendingAnswer = approvals.request(request());
    const [pending] = approvals.pending();
    approvals.answer({ requestId: pending!.requestId, decision: "deny" });

    expect(approvals.answer({ requestId: pending!.requestId, decision: "allow" })).toBe(false);
    await expect(pendingAnswer).resolves.toEqual({ decision: "deny" });
  });

  it("stops telling a listener once it unsubscribed", async () => {
    const approvals = createMiniAppToolApprovals();
    const listener = vi.fn();
    const stop = approvals.subscribe(listener);
    stop();

    approvals.request(request());
    approvals.answer({ requestId: approvals.pending()[0]!.requestId, decision: "deny" });

    expect(listener).not.toHaveBeenCalled();
  });
});
