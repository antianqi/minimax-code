// Agent turn lifecycle, page reload, session switching, and streaming resume.
//
// The existing transcript spec covers message paging and live-view ownership.
// This file covers the *transport* half of a turn: what the client does from
// `sendMessage` through the first frames, through a mid-turn socket drop or a
// `resume_overflow`, to `[DONE]` — and what survives a reload or a session
// round trip in between. Every assertion runs against the built client driven
// by the in-page fixture, so the wire shapes here are the real ones.

import { expect } from "@playwright/test";

import {
  assistantBody,
  configureFixture,
  dropStream,
  emitAgentMessage,
  emitStream,
  liveIndicator,
  livePulse,
  openApp,
  requestCount,
  startTurn,
  switchSession,
  test,
} from "./harness.mjs";

async function stageHistory(page, messages) {
  await page.evaluate((nextMessages) => window.__fixture.setPage("A", {
    messages: nextMessages,
    hasMore: false,
  }), messages);
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  page.on("console", (message) => console.log("BROWSER_CONSOLE", message.type(), message.text()));
});

for (const theme of ["light", "dark"]) {
test(`immediate sending presents the selected queue input before acknowledgement (${theme})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem("webui-theme", value), theme);
  await configureFixture(page, () => {
    window.__fixture.setActiveTurn({ turnId: "queue-active", busyReason: "turn", locallyOwned: false });
    window.__fixture.setResponse("listQueueMessages", { items: [{ itemId: "selected-queue", sessionId: "A", status: "queued", content: "Act on this queued instruction." }] });
    window.__fixture.delayEvery("steerQueueItem", { id: "A" });
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "立即发送" }).click();
  const pending = page.locator('[data-webui-transcript="A"] [data-webui-pending-queue-item="selected-queue"]');
  await expect(pending).toContainText("Act on this queued instruction.");
  await expect(pending).toContainText("正在立即发送");
  await page.screenshot({ path: test.info().outputPath("pending-queue-input.png"), animations: "disabled" });
  await expect(page.locator('[data-webui-queue-item="selected-queue"]')).toHaveCount(0);
  await pending.evaluate((node) => { node.dataset.queueIdentityProbe = "same-element"; });
  await emitAgentMessage(page, "A", { msg_id: "prior-assistant", msg_content: "Late output from the prior execution." });
  await expect(page.locator('[data-webui-message-role]')).toHaveText([
    /History A synthetic/, /Late output from the prior execution\./, /Act on this queued instruction\./,
  ]);
  await page.evaluate(() => window.__fixture.resolve("steerQueueItem", { id: "A" }, { success: true, queueItemId: "selected-queue", turnId: "queue-active" }));
  await expect(pending).toContainText("已受理，等待处理");
  await emitAgentMessage(page, "A", { msg_id: "msg-user-canonical-queue", msg_content: "Act on this queued instruction.", source_message_id: "selected-queue" });
  const confirmed = page.locator('[data-webui-message-role="user"][data-message-id="msg-user-canonical-queue"]');
  await expect(confirmed).toHaveAttribute("data-queue-identity-probe", "same-element");
  await expect(pending).toHaveCount(0);
  await expect(page.locator('[data-webui-message-role="user"]').filter({ hasText: "Act on this queued instruction." })).toHaveCount(1);
});

test(`a refused immediate send keeps its input and retries only from its failed state (${theme})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem("webui-theme", value), theme);
  await configureFixture(page, () => {
    window.__fixture.setResponse("listQueueMessages", { items: [{ itemId: "refused-queue", sessionId: "A", status: "queued", content: "Retain this refused input." }] });
    window.__fixture.refuseOperation("steerQueueItem", "invalid_request", "Synthetic queued input refusal.");
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "立即发送" }).click();
  const pending = page.locator('[data-webui-pending-queue-item="refused-queue"]');
  await expect(pending).toContainText("Retain this refused input.");
  await expect(pending).toContainText("立即发送失败");
  await page.screenshot({ path: test.info().outputPath("failed-queue-input.png"), animations: "disabled" });
  await page.evaluate(() => {
    window.__fixture.allowOperation("steerQueueItem");
    window.__fixture.setResponse("steerQueueItem", { success: true, queueItemId: "refused-queue", turnId: "accepted-turn" });
  });
  await pending.getByRole("button", { name: "重试发送" }).click();
  await expect(pending).toContainText("已受理，等待处理");
  expect(await page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "steerQueueItem").length)).toBe(2);
});

test(`an unknown immediate-send outcome rechecks history without resending (${theme})`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem("webui-theme", value), theme);
  await configureFixture(page, () => {
    window.__fixture.setResponse("listQueueMessages", { items: [{ itemId: "unknown-queue", sessionId: "A", status: "queued", content: "Check this uncertain input." }] });
    window.__fixture.refuseOperation("steerQueueItem", "internal_error", "Outcome is uncertain.");
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "立即发送" }).click();
  const pending = page.locator('[data-webui-pending-queue-item="unknown-queue"]');
  await expect(pending).toContainText("发送结果待确认");
  await expect(pending.getByRole("button", { name: "重试发送" })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("unknown-queue-input.png"), animations: "disabled" });
  await page.evaluate(() => window.__fixture.setPage("A", { messages: [{ msgId: "canonical-unknown", role: "user", msgContent: "Check this uncertain input.", sourceMessageId: "unknown-queue" }], hasMore: false }));
  await pending.getByRole("button", { name: "重新核对" }).click();
  await expect(pending).toHaveCount(0);
  await expect(page.locator('[data-webui-message-role="user"]').filter({ hasText: "Check this uncertain input." })).toHaveCount(1);
  expect(await page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "steerQueueItem").length)).toBe(1);
});
}

test("an agent turn streams thinking and answer, then settles on DONE", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Run the synthetic turn");
  await expect(liveIndicator(page)).toBeVisible();

  await emitAgentMessage(page, "A", {
    msg_id: "a-turn-1",
    thinking_content: "Synthetic reasoning",
    msg_content: "Synthetic answer one",
  });
  const body = assistantBody(page, "a-turn-1");
  await expect(body).toBeVisible();
  await expect(body.getByText("Synthetic answer one")).toBeVisible();
  await expect(body.getByText("Synthetic reasoning")).toBeVisible();

  // Thinking deltas append to the existing message and remain visible even
  // when a later whole-message frame only carries a tool update.
  await emitStream(page, "A", {
    dataJson: JSON.stringify({
      type: "agent_message_chunk",
      agent_message_chunk: { msg_id: "a-turn-1", thinking_content: " plus" },
    }),
  });
  await expect(body.getByText("Synthetic reasoning plus")).toBeVisible();

  // A tool call landing on the same message must not displace the answer.
  await emitAgentMessage(page, "A", {
    msg_id: "a-turn-1",
    tool_calls: [{ id: "call-1", function: { name: "bash", arguments: JSON.stringify({ command: "ls -la" }) } }],
  });
  await expect(body.getByText("Synthetic answer one")).toBeVisible();
  await expect(body.getByText("Synthetic reasoning plus")).toBeVisible();

  // The per-turn pulse is the element the stranded-animation bug lived on:
  // while the turn streams it is present exactly once, and `[DONE]` must
  // clear it.
  await expect(livePulse(page)).toHaveCount(1);
  await stageHistory(page, [{
    msgId: "a-turn-1",
    role: "assistant",
    msgContent: "Synthetic answer one",
    thinkingContent: "Synthetic reasoning plus",
    timestamp: 1_700_000_000_100,
  }]);
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(livePulse(page)).toHaveCount(0);
  await expect(body.getByText("Synthetic answer one")).toHaveCount(1);
  // The answer landed once, not once per frame the turn delivered.
  await expect(page.locator('[data-webui-transcript="A"]')).toBeVisible();
  await expect(page.locator('[data-webui-message-kind="assistant"]')).toHaveCount(1);
});

test("the reasoning can be folded away while the turn is still streaming", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Run the synthetic turn");
  await emitAgentMessage(page, "A", {
    msg_id: "a-fold-1",
    thinking_content: "Synthetic reasoning",
    msg_content: "Synthetic answer",
  });

  // The reasoning opens by itself while the turn streams.
  const reasoning = page.locator('[data-webui-thinking="true"]').first();
  await expect(reasoning).toBeVisible();
  await expect(reasoning).toHaveAttribute("aria-expanded", "true");

  // The reader folds it away, and it stays folded: the turn keeps streaming, and
  // the stream must not keep folding the reasoning back open under the reader's
  // hand.
  await reasoning.click();
  await expect(reasoning).toHaveAttribute("aria-expanded", "false");
  await emitStream(page, "A", {
    dataJson: JSON.stringify({
      type: "agent_message_chunk",
      agent_message_chunk: { msg_id: "a-fold-1", thinking_content: " and more reasoning" },
    }),
  });
  await expect(reasoning).toHaveAttribute("aria-expanded", "false");
  // The turn is still running: the live pulse says so.
  await expect(livePulse(page)).toHaveCount(1);

  // And the reader can open it again.
  await reasoning.click();
  await expect(reasoning).toHaveAttribute("aria-expanded", "true");
});

test("the turn process can be folded away while the turn is still streaming", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Run the synthetic turn");
  await emitAgentMessage(page, "A", {
    msg_id: "a-fold-2",
    thinking_content: "Synthetic reasoning",
    msg_content: "Synthetic answer",
  });

  const process = page.locator('[data-testid="turn-process-trigger"]').first();
  await expect(process).toHaveAttribute("aria-expanded", "true");
  await process.click();
  await expect(process).toHaveAttribute("aria-expanded", "false");
  // The live turn is unaffected: it keeps running and keeps reporting itself.
  await expect(livePulse(page)).toHaveCount(1);
  await process.click();
  await expect(process).toHaveAttribute("aria-expanded", "true");
});

test("a failed initial active-turn probe recovers while the event channel stays connected", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setActiveTurn({ turnId: "probe-recovery", busyReason: "turn", locallyOwned: false });
    window.__fixture.delayNext("getActiveTurn", { id: "A" });
  });
  await openApp(page, "#session=A");
  await expect(page.getByText("History A synthetic", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) => request.operation === "watchEvents"))).toBe(true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.__fixture.dropRequest("getActiveTurn", { id: "A" }));
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) => request.operation === "resumeSession" && request.body.id === "A"))).toBe(true);
  await emitAgentMessage(page, "A", { msg_id: "probe-recovered-answer", msg_content: "Recovered without a reconnect or navigation." });
  await expect(page.getByText("Recovered without a reconnect or navigation.")).toBeVisible();
  expect(await page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "watchEvents").length)).toBe(1);
});

test("cached user mutation controls wait until generation has ended", async ({ page }) => {
  await configureFixture(page, () => window.__fixture.setPage("A", {
    messages: [{ msgId: "editable-user", role: "user", msgContent: "Previously completed input", actions: { rewind: true, edit: true } }],
  }));
  await openApp(page, "#session=A");
  const user = page.locator('[data-webui-message-role="user"]').filter({ hasText: "Previously completed input" });
  await expect(user.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
  await startTurn(page, "A", "Continue this conversation");
  await expect(user.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(user.getByRole("button", { name: "回退", exact: true })).toHaveCount(0);
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(user.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
  await expect(user.getByRole("button", { name: "回退", exact: true })).toBeVisible();
});

test("reload discards unconfirmed local queue intent without resubmitting", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setResponse("listQueueMessages", { items: [{ itemId: "discard-on-reload", sessionId: "A", status: "queued", content: "Local input may be discarded" }] });
    window.__fixture.delayNext("steerQueueItem", { id: "A" });
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "立即发送" }).click();
  await expect(page.locator('[data-webui-pending-queue-item="discard-on-reload"]')).toBeVisible();
  await page.reload();
  await expect(page.getByText("History A synthetic", { exact: true })).toBeVisible();
  await expect(page.locator("[data-webui-pending-queue-item]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "steerQueueItem").length)).toBe(0);
});

test("an open editor retains its draft but cannot submit during generation", async ({ page }) => {
  await configureFixture(page, () => window.__fixture.setPage("A", {
    messages: [{ msgId: "editable-user", role: "user", msgContent: "Previously completed input", actions: { rewind: true, edit: true } }],
  }));
  await openApp(page, "#session=A");
  await page.getByTestId("user-message-edit-button").click();
  const editor = page.getByTestId("user-message-inline-editor");
  await editor.getByRole("textbox").fill("Keep this edit draft");
  await page.getByPlaceholder("输入消息…（输入 / 唤起命令）").fill("A concurrent turn");
  await page.locator("[data-webui-composer-submit]").click();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) => request.operation === "sendMessage"))).toBe(true);
  await expect(editor.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "取消", exact: true })).toBeEnabled();
  await expect(editor.getByRole("textbox")).toHaveValue("Keep this edit draft");
  await page.screenshot({ path: test.info().outputPath("editor-during-generation.png"), animations: "disabled" });
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(editor.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  await expect(editor.getByRole("textbox")).toHaveValue("Keep this edit draft");
});

test("an open rewind preview cannot confirm a concurrently started turn", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("webui-theme", "dark"));
  await configureFixture(page, () => {
    window.__fixture.setPage("A", {
      messages: [{ msgId: "editable-user", role: "user", msgContent: "Previously completed input", actions: { rewind: true, edit: true } }],
    });
    window.__fixture.setResponse("getSessionRewindPreview", { sessionId: "A", userMessageId: "editable-user", turns: [] });
  });
  await openApp(page, "#session=A");
  await page.getByTestId("user-message-rewind-button").click();
  const dialog = page.getByTestId("rewind-preview-dialog");
  await expect(dialog.getByTestId("rewind-confirm-only")).toBeEnabled();
  await page.evaluate(() => {
    window.__fixture.setActiveTurn({ turnId: "concurrent", busyReason: "turn", locallyOwned: false });
    window.__fixture.emitEvent({ type: "session.start", payload: { sessionId: "A", turnId: "concurrent" }, timestamp: Date.now(), source: "synthetic" });
  });
  await expect(dialog.getByTestId("rewind-confirm-only")).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("rewind-during-generation.png"), animations: "disabled" });
  await page.evaluate(() => window.__fixture.setActiveTurn(undefined));
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(dialog.getByTestId("rewind-confirm-only")).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("a server-initiated turn attaches a stream instead of hanging on 思考中", async ({ page }) => {
  await openApp(page, "#session=A");
  // The goal flow posts a hidden continuation prompt, a queued message
  // drains, another client sends — all of them start a turn without this
  // client calling sendMessage. The runtime still publishes `session.start`,
  // and that event is the only notice the client gets.
  await page.evaluate(() => window.__fixture.emitEvent({
    type: "session.start",
    payload: { sessionId: "A", turnId: "external-turn-1" },
    timestamp: 1_700_000_000_300,
    source: "synthetic",
  }));

  // Without a stream the transcript stays empty for the whole turn: the
  // composer shows 思考中 and nothing ever renders.
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.id === "A",
  ))).toBe(true);

  await emitAgentMessage(page, "A", { msg_id: "external-1", msg_content: "Externally started answer" });
  await expect(page.getByText("Externally started answer")).toBeVisible();

  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
});

test("a turn whose session.start was missed is recovered through the active-turn probe", async ({ page }) => {
  // The event can land before the client finished subscribing, or be lost
  // across a watchEvents reconnect. The session list cannot cover the gap —
  // its status carries no turn id — so the client asks the server instead.
  await configureFixture(page, () => window.__fixture.setActiveTurn({ turnId: "missed-turn", busyReason: "turn", locallyOwned: false }));
  await openApp(page, "#session=A");

  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "getActiveTurn" && request.body.id === "A",
  ))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.id === "A",
  ))).toBe(true);

  await emitAgentMessage(page, "A", { msg_id: "missed-1", msg_content: "Recovered answer" });
  await expect(page.getByText("Recovered answer")).toBeVisible();
  await stageHistory(page, [{ msgId: "missed-1", role: "assistant", msgContent: "Recovered answer", timestamp: 1_700_000_000_110 }]);
  await page.evaluate(() => window.__fixture.setActiveTurn(null));
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
});

test("a compaction does not pull the transcript into a stream", async ({ page }) => {
  // `busyReason: "compaction"` means the session is busy without producing an
  // assistant transcript; attaching would leave a stream with nothing to show.
  await configureFixture(page, () => window.__fixture.setActiveTurn({ turnId: "compacting-turn", busyReason: "compaction", locallyOwned: false }));
  await openApp(page, "#session=A");
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "getActiveTurn",
  ))).toBe(true);
  expect(await page.evaluate(() => window.__fixture.requests.filter(
    (request) => request.operation === "resumeSession",
  ).length)).toBe(0);
});

test("a mid-turn socket drop resumes from the last cursor and keeps the turn", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Synthetic resume turn");
  await emitAgentMessage(page, "A", { msg_id: "a-turn-1", msg_content: "Before the drop" }, "cursor-1");
  await expect(page.getByText("Before the drop")).toBeVisible();

  await dropStream(page, "A");
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.afterCursor === "cursor-1",
  ))).toBe(true);

  // The replacement subscription keeps delivering into the same turn.
  await emitAgentMessage(page, "A", { msg_id: "a-turn-2", msg_content: "After the drop" }, "cursor-2");
  await expect(page.getByText("After the drop")).toBeVisible();
  await stageHistory(page, [
    { msgId: "a-turn-1", role: "assistant", msgContent: "Before the drop", timestamp: 1_700_000_000_120 },
    { msgId: "a-turn-2", role: "assistant", msgContent: "After the drop", timestamp: 1_700_000_000_121 },
  ]);
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(page.getByText("Before the drop")).toBeVisible();
  await expect(page.getByText("After the drop")).toBeVisible();
});

test("resume_overflow reloads authoritative history and resubscribes without a cursor", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setPage("A", {
      messages: [{ msgId: "history-a-authoritative", role: "user", msgContent: "Authoritative history A", timestamp: 1_700_000_000_050 }],
      hasMore: false,
    });
  });
  await openApp(page, "#session=A");
  const beforeOverflow = await requestCount(page, "getMessages");
  await startTurn(page, "A", "Synthetic overflow turn");
  await emitAgentMessage(page, "A", { msg_id: "a-turn-1", msg_content: "Live only message" }, "cursor-1");
  await expect(page.getByText("Live only message")).toBeVisible();

  await emitStream(page, "A", { dataJson: JSON.stringify({ type: "resume_overflow" }) });
  // The loop only inspects `nextAction` once the current subscription
  // settles, so the server ending the stream is what hands control to the
  // resync branch. Without this `[DONE]` the test would pass vacuously.
  await emitStream(page, "A", { dataJson: "[DONE]" });

  // The resync path reloads history, so the live-only message is replaced by
  // the server's authoritative view rather than kept alongside it.
  await expect.poll(() => requestCount(page, "getMessages")).toBeGreaterThan(beforeOverflow);
  await expect(page.getByText("Authoritative history A")).toBeVisible();
  await expect(page.getByText("Live only message")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.afterCursor === undefined,
  ))).toBe(true);

  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
});

test("a page reload restores history and never revives a finished turn", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setPage("A", {
      messages: [
        { msgId: "history-user", role: "user", msgContent: "Persisted question", timestamp: 1_700_000_000_060 },
        { msgId: "history-assistant", role: "assistant", msgContent: "Persisted answer", thinkingContent: "Persisted reasoning", timestamp: 1_700_000_000_061 },
      ],
      hasMore: false,
    });
  });
  await openApp(page, "#session=A");
  await expect(page.getByText("Persisted answer")).toBeVisible();
  await expect(page.getByText("Persisted reasoning")).toBeVisible();
  await expect(liveIndicator(page)).toHaveCount(0);

  await page.reload();
  await expect(page.locator("#webui-root")).toBeVisible();
  await expect(page.getByText("Persisted question")).toHaveCount(1);
  await expect(page.getByText("Persisted answer")).toHaveCount(1);
  await expect(page.getByText("Persisted reasoning")).toHaveCount(1);
  // A reloaded client has no live turn: neither the bottom indicator nor the
  // per-turn pulse may reappear from reloaded history alone.
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(livePulse(page)).toHaveCount(0);
});

test("an active turn reload restores thinking, resumes, and preserves message order", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setPage("A", {
      messages: [
        { msgId: "reload-user", role: "user", msgContent: "Question before reload", timestamp: 1_700_000_000_070 },
      ],
      hasMore: false,
    });
    window.__fixture.setActiveTurn({ turnId: "reload-active-turn", busyReason: "turn", locallyOwned: false });
  });
  await openApp(page, "#session=A");
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.id === "A",
  ))).toBe(true);
  await emitStream(page, "A", {
    dataJson: JSON.stringify({
      type: "agent_message_chunk",
      agent_message_chunk: {
        msg_id: "reload-assistant",
        thinking_content: "Reasoning before reload",
        msg_content: "Answer before reload",
      },
    }),
  });
  await expect(page.getByText("Reasoning before reload")).toBeVisible();
  await expect(page.getByText("Answer before reload")).toBeVisible();

  await page.reload();
  await expect(page.locator("#webui-root")).toBeVisible();
  await expect(liveIndicator(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.id === "A",
  ))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.filter(
    (request) => request.operation === "resumeSession" && request.body.id === "A",
  ).at(-1)?.body.afterMsgId)).toBe("reload-user");

  await emitStream(page, "A", {
    dataJson: JSON.stringify({
      type: "agent_message_chunk",
      agent_message_chunk: {
        msg_id: "reload-assistant",
        thinking_content: "Reasoning before reload",
        msg_content: "Answer before reload",
      },
    }),
  });
  await expect(page.getByText("Reasoning before reload")).toBeVisible();
  await expect(page.getByText("Answer before reload")).toBeVisible();
  await expect(page.getByText("Reasoning before reload")).toBeVisible();
  await expect(page.getByText("Answer before reload")).toBeVisible();

  await emitStream(page, "A", {
    dataJson: JSON.stringify({
      type: "agent_message_chunk",
      agent_message_chunk: {
        msg_id: "reload-assistant",
        thinking_content: " and resumed reasoning",
        msg_content: " and resumed answer",
      },
    }),
  });
  await expect(page.getByText("Reasoning before reload and resumed reasoning")).toBeVisible();
  await expect(page.getByText("Answer before reload and resumed answer")).toBeVisible();

  await emitAgentMessage(page, "A", {
    msg_id: "reload-final-assistant",
    thinking_content: "Final reasoning",
    msg_content: "Final answer",
  });
  await expect(page.getByText("Final reasoning")).toBeVisible();
  await expect(page.getByText("Final answer")).toBeVisible();

  const transcriptText = await page.locator('[data-webui-transcript="A"]').innerText();
  const orderedContent = [
    "Question before reload",
    "Reasoning before reload and resumed reasoning",
    "Answer before reload and resumed answer",
    "Final reasoning",
    "Final answer",
  ].map((content) => transcriptText.indexOf(content));
  expect(orderedContent.every((index) => index >= 0)).toBe(true);
  expect(orderedContent).toEqual([...orderedContent].sort((left, right) => left - right));

  await stageHistory(page, [
    { msgId: "reload-user", role: "user", msgContent: "Question before reload", timestamp: 1_700_000_000_070 },
    { msgId: "reload-assistant", role: "assistant", thinkingContent: "Reasoning before reload and resumed reasoning", msgContent: "Answer before reload and resumed answer", timestamp: 1_700_000_000_071 },
    { msgId: "reload-final-assistant", role: "assistant", thinkingContent: "Final reasoning", msgContent: "Final answer", timestamp: 1_700_000_000_072 },
  ]);
  await page.evaluate(() => window.__fixture.setActiveTurn(null));
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(page.getByText("Reasoning before reload and resumed reasoning")).toHaveCount(1);
  await expect(page.getByText("Final answer")).toHaveCount(1);
  await expect(liveIndicator(page)).toHaveCount(0);
});

test("switching away and back keeps a live turn attached to its own session", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Synthetic switch turn");
  await emitAgentMessage(page, "A", { msg_id: "a-turn-1", msg_content: "A first message" });
  await expect(page.getByText("A first message")).toBeVisible();

  await switchSession(page, "B");
  await expect(page.getByText("History B synthetic")).toBeVisible();
  await emitAgentMessage(page, "A", { msg_id: "a-turn-2", msg_content: "A late message" });
  await expect(page.getByText("A late message")).toHaveCount(0);

  await switchSession(page, "A");
  await expect(page.getByText("A first message")).toBeVisible();
  await expect(page.getByText("A late message")).toBeVisible();
  await expect(page.getByText("History B synthetic")).toHaveCount(0);
  // The turn is still running, so coming back must restore the live state.
  await expect(liveIndicator(page)).toBeVisible();

  await stageHistory(page, [
    { msgId: "a-turn-1", role: "assistant", msgContent: "A first message", timestamp: 1_700_000_000_130 },
    { msgId: "a-turn-2", role: "assistant", msgContent: "A late message", timestamp: 1_700_000_000_131 },
  ]);
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(page.getByText("A late message")).toBeVisible();
});

test("a goal continuation keeps one activity indicator at the tail of the transcript", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Run the goal turn");

  await emitAgentMessage(page, "A", {
    msg_id: "a-round-1",
    thinking_content: "First round reasoning",
    msg_content: "First round answer",
  });
  const first = assistantBody(page, "a-round-1");
  await expect(first).toBeVisible();
  await expect(livePulse(page)).toHaveCount(1);

  // Goal mode auto-continuation arrives as a SYNTHETIC USER message. A user
  // item opens a new group inside the still-live turn, so from here on one turn
  // owns two assistant groups.
  await emitAgentMessage(page, "A", {
    msg_id: "msg-user-goal-continuation-1",
    msg_content: "Continue working toward the active thread goal.",
  });
  await expect(page.getByText("Continue working toward the active thread goal.")).toBeVisible();

  // The previous round has settled and no message body is left to host the
  // row, so the indicator must hand off to the transcript-level status instead
  // of stranding itself above the continuation bubble.
  await expect(livePulse(page)).toHaveCount(0);
  await expect(liveIndicator(page)).toHaveCount(1);
  await expect(first.getByText("First round reasoning")).toHaveCount(1);
  // The settled round must not carry the next round's streamed content.
  await expect(first.getByText("Second round reasoning")).toHaveCount(0);

  await emitAgentMessage(page, "A", {
    msg_id: "a-round-2",
    thinking_content: "Second round reasoning",
  });
  const second = assistantBody(page, "a-round-2");
  await expect(second).toBeVisible();

  // The invariant: exactly one activity row in the whole transcript, hosted by
  // the trailing group.
  await expect(livePulse(page)).toHaveCount(1);
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(second.locator('[data-webui-thinking-live-status="true"]')).toHaveCount(1);
  await expect(first.locator('[data-webui-thinking-live-status="true"]')).toHaveCount(0);

  // Each round shows its own content once — the turn-wide live view used to be
  // broadcast into every live group, duplicating the stream across the thread.
  await expect(first.getByText("First round reasoning")).toHaveCount(1);
  await expect(second.getByText("Second round reasoning")).toHaveCount(1);
  await expect(page.getByText("First round answer")).toHaveCount(1);

  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(livePulse(page)).toHaveCount(0);
  await expect(liveIndicator(page)).toHaveCount(0);
});

test("assistant messages merged into one group keep a single activity indicator", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Run the merged turn");

  await emitAgentMessage(page, "A", {
    msg_id: "a-merged-1",
    thinking_content: "Alpha reasoning",
    msg_content: "Alpha answer",
  });
  await expect(livePulse(page)).toHaveCount(1);

  // Consecutive assistant messages merge into the same group, so the group tail
  // — not the transcript tail — is what hosts the row.
  await emitAgentMessage(page, "A", {
    msg_id: "a-merged-2",
    thinking_content: "Beta reasoning",
  });
  const body = assistantBody(page, "a-merged-1");
  await expect(body.getByText("Beta reasoning")).toBeVisible();

  await expect(page.locator('[data-webui-assistant-body]')).toHaveCount(1);
  await expect(livePulse(page)).toHaveCount(1);
  await expect(liveIndicator(page)).toHaveCount(0);
  await expect(body.locator('[data-webui-thinking-live-status="true"]')).toHaveCount(1);
  // The merged group keeps both of its own messages, each exactly once.
  await expect(body.getByText("Alpha reasoning")).toHaveCount(1);
  await expect(body.getByText("Alpha answer")).toHaveCount(1);
});

test("a queued user message hands the activity indicator to the transcript tail", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Run the queued turn");

  await emitAgentMessage(page, "A", {
    msg_id: "a-queued-1",
    thinking_content: "Gamma reasoning",
    msg_content: "Gamma answer",
  });
  await expect(livePulse(page)).toHaveCount(1);
  await emitAgentMessage(page, "A", {
    msg_id: "a-queued-2",
    thinking_content: "Delta reasoning",
  });
  await expect(livePulse(page)).toHaveCount(1);

  // A queued follow-up opens a trailing USER group. The assistant group that
  // was hosting the row is no longer the transcript tail, so the row has to
  // move down rather than strand itself above the bubble.
  await emitAgentMessage(page, "A", {
    msg_id: "msg-user-queued-1",
    msg_content: "Queued follow-up",
  });
  await expect(page.getByText("Queued follow-up")).toBeVisible();

  await expect(livePulse(page)).toHaveCount(0);
  await expect(liveIndicator(page)).toHaveCount(1);
  await expect(page.getByText("Delta reasoning")).toHaveCount(1);

  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(liveIndicator(page)).toHaveCount(0);
});

test("approving a plan reattaches when the resumed turn start event was missed", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "绘制 SVG 花朵");
  await emitAgentMessage(page, "A", {
    msg_id: "plan-review-message",
    msg_content: "方案已写入 plan.md。",
  });

  await page.evaluate(() => window.__fixture.emitEvent({
    type: "questionnaire.ask",
    payload: {
      sessionId: "A",
      request: {
        schemaVersion: 2,
        id: "plan-review-request",
        title: "计划完成，实施计划？",
        presentation: { replaceComposer: true, showProgress: true, allowBackNavigation: true },
        steps: [{
          id: "plan-review",
          question: "确认实施计划",
          description: "方案已写好",
          selectionMode: 0,
          allowOther: false,
          otherPlaceholder: "",
          required: false,
        }],
        mode: "plan",
        tool: { messageId: "plan-review-message", callId: "plan-review-call" },
        modePayload: { planReview: { markdown: "# SVG 花朵\n\n实施步骤", path: "/workspace/plan.md" } },
      },
    },
    timestamp: 1_700_000_000_250,
    source: "synthetic",
  }));
  await expect(page.getByTestId("plan-review-approve")).toBeVisible();

  // The plan-writing stream ends while the questionnaire keeps the turn open.
  // After approval, the runtime continues that turn; this test deliberately
  // omits its session.start event to exercise the same recovery gap as a missed
  // process event during reconnect.
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await page.evaluate(() => window.__fixture.setActiveTurn({
    turnId: "plan-execution-turn",
    busyReason: "turn",
    locallyOwned: false,
  }));
  await page.evaluate(() => window.__fixture.delayEvery("getActiveTurn", { id: "A" }));
  await page.getByTestId("plan-review-approve").click();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "replyQuestionnaire" && request.body.requestId === "plan-review-request",
  ))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__fixture.pending.some(
    (request) => request.operation === "getActiveTurn" && request.body.id === "A",
  ))).toBe(true);
  await expect(page.getByText("思考中…")).toBeVisible();
  await page.evaluate(() => window.__fixture.resolve("getActiveTurn", { id: "A" }, {
    turnId: "plan-execution-turn",
    busyReason: "turn",
    locallyOwned: false,
  }));

  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some(
    (request) => request.operation === "resumeSession" && request.body.id === "A",
  ))).toBe(true);
  await emitAgentMessage(page, "A", {
    msg_id: "plan-execution-reply",
    thinking_content: "开始按计划实施。",
    msg_content: "已完成第一步。",
  });
  await expect(page.getByText("已完成第一步。", { exact: true })).toBeVisible();
});

/** Ordered `ANSWER` / `PULSE` markers as rendered inside the assistant body. */
async function assistantRowOrder(page) {
  return page.evaluate(() => {
    const body = document.querySelector("[data-webui-assistant-body]");
    if (!body) return [];
    const kinds = [];
    const walk = (element) => {
      for (const child of element.children) {
        if (child.hasAttribute("data-webui-thinking-live-status")) kinds.push("PULSE");
        else if (child.classList.contains("webui-assistant-answer")) kinds.push("ANSWER");
        walk(child);
      }
    };
    walk(body);
    return kinds;
  });
}

test("a reply delivered as its own text-only message still renders above the pulse", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Run the split turn");

  // The tool round lands in its own message.
  await emitAgentMessage(page, "A", {
    msg_id: "a-split-1",
    thinking_content: "Let me check the goal first.",
    tool_calls: [{ id: "call-1", function: { name: "update_goal", arguments: JSON.stringify({ status: "waiting" }) } }],
  });
  await expect(livePulse(page)).toHaveCount(1);

  // The reply arrives as a SEPARATE message carrying text only. The live
  // projection used to drop that segment, so the answer lost its text part,
  // `primaryAnswerPart` went undefined, and the answer rendered AFTER the
  // whole process block — below the activity row instead of above it.
  await emitAgentMessage(page, "A", { msg_id: "a-split-2", msg_content: "Split reply" });
  await expect(page.getByText("Split reply")).toBeVisible();

  const order = await assistantRowOrder(page);
  expect(order).toContain("ANSWER");
  expect(order.indexOf("ANSWER")).toBeLessThan(order.indexOf("PULSE"));
  expect(order[order.length - 1]).toBe("PULSE");
  await expect(livePulse(page)).toHaveCount(1);

  await stageHistory(page, [
    { msgId: "a-split-1", role: "assistant", thinkingContent: "Let me check the goal first.", timestamp: 1_700_000_000_140 },
    { msgId: "a-split-2", role: "assistant", msgContent: "Split reply", timestamp: 1_700_000_000_141 },
  ]);
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(livePulse(page)).toHaveCount(0);
  await expect(page.getByText("Split reply")).toHaveCount(1);
});

test("a plain text-only turn keeps its reply free of any process disclosure", async ({ page }) => {
  await openApp(page, "#session=A");
  await startTurn(page, "A", "Run the plain turn");

  // No thinking, no tool call: the per-view guard must keep the turn from
  // growing a disclosure just because text parts now survive the projection.
  await emitAgentMessage(page, "A", { msg_id: "a-plain-1", msg_content: "Plain reply" });
  await expect(page.getByText("Plain reply")).toBeVisible();
  await expect(livePulse(page)).toHaveCount(0);

  const body = page.locator("[data-webui-assistant-body]").first();
  await expect(body.locator("summary")).toHaveCount(0);
  await expect(body.locator("details")).toHaveCount(0);
  await expect(body.locator('[data-webui-message-kind="assistant"]')).toHaveCount(1);

  await stageHistory(page, [{ msgId: "a-plain-1", role: "assistant", msgContent: "Plain reply", timestamp: 1_700_000_000_150 }]);
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(body.locator("summary")).toHaveCount(0);
  await expect(body.locator("details")).toHaveCount(0);
  await expect(page.getByText("Plain reply")).toHaveCount(1);
});
