// Connection notices, end to end against the built client.
//
// Only one state is announced: a terminal failure. Reconnect attempts are
// silent, because they retry themselves within a few hundred milliseconds and
// a notice for them appeared at every page load and every tab wake. What only a
// real browser proves here:
//
//   1. The shell mounts the component, so the failure really reaches the page.
//   2. A dropped stream that the loop can resume shows nothing — no region, no
//      toast, no 重连 text — and the resumed frames still land appending to the
//      same turn.
//   3. An idle disconnect between turns is equally silent, through several
//      retry loops and after the link returns.
//   4. A failure with nothing to resume from shows 连接失败 with the real
//      reason, and 重试连接 reopens the stream — the recovered loop then
//      delivers frames, which is the "actually recovers" half a banner that
//      only repaints cannot prove.
//
// Mechanism: the fixture's `delayEvery` holds the automatic resume request
// pending, which is what keeps a reconnect observable long enough to assert its
// silence instead of racing past between two Playwright calls.

import { expect } from "@playwright/test";

import { openApp, test, startTurn, emitStream, dropStream } from "./harness.mjs";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("BROWSER_CONSOLE_ERROR", message.text()); });
});

/** The inline region, which only ever carries the healthy state. */
function region(page) {
  return page.locator('[data-testid="webui-connection-status"]');
}

/** The failure notice; the only place a connection problem is announced. */
function failureToast(page) {
  return page.locator('[data-testid="webui-connection-status-toast"]');
}

test("a dropped stream stays silent, and the resumed frames still land", async ({ page }) => {
  await openApp(page, "#session=A");

  await startTurn(page, "A", "hello");
  await expect(region(page)).toHaveCount(0);

  // Record a cursor, so the drop has something to resume from.
  await emitStream(page, "A", {
    cursor: "c1",
    dataJson: JSON.stringify({
      type: "agent_message_chunk",
      agent_message_chunk: { msgId: "m1", msgContent: "部分回答" },
    }),
  });

  // Hold the automatic resume so the reconnect window is long enough to prove
  // that nothing is drawn during it.
  await page.evaluate(() => window.__fixture.delayEvery("resumeSession", { id: "A" }));
  await dropStream(page, "A");

  // Several retry loops' worth of silence: no region, no toast, and no 重连
  // wording anywhere on the page.
  await page.waitForTimeout(600);
  await expect(region(page)).toHaveCount(0);
  await expect(failureToast(page)).toHaveCount(0);
  await expect(page.getByText(/正在重连|重连中/u)).toHaveCount(0);

  // Release the resume; the recovered stream keeps appending to the same turn.
  await page.evaluate(() => window.__fixture.resolve("resumeSession", { id: "A" }, { stream: true }));
  await emitStream(page, "A", {
    dataJson: JSON.stringify({
      type: "agent_message_chunk",
      agent_message_chunk: { msgId: "m1", msgContent: "部分回答，恢复了" },
    }),
  });
  await expect(page.getByText(/部分回答，恢复了/u)).toBeVisible();
  await expect(failureToast(page)).toHaveCount(0);
});

test("an idle disconnect between turns is silent through the outage and after it", async ({ page }) => {
  await openApp(page, "#session=A");

  // Idle and healthy: nothing shown.
  await expect(region(page)).toHaveCount(0);

  // Every live socket dropped and new connections gated shut: a server that
  // went away between turns. Nothing is announced — the transport reconnects
  // on its own.
  await page.evaluate(() => {
    window.__fixture.gateSockets(false);
    window.__fixture.dropAll();
  });
  await page.waitForTimeout(600);
  await expect(region(page)).toHaveCount(0);
  await expect(failureToast(page)).toHaveCount(0);
  await expect(page.getByText(/正在重连|重连中/u)).toHaveCount(0);

  // The server returns; the watcher's own reconnect is accepted and still
  // nothing was ever announced.
  await page.evaluate(() => window.__fixture.gateSockets(true));
  await page.waitForTimeout(300);
  await expect(failureToast(page)).toHaveCount(0);

  // A second outage behaves the same way, so recovery did not leave a notice
  // stuck behind.
  await page.evaluate(() => {
    window.__fixture.gateSockets(false);
    window.__fixture.dropAll();
  });
  await page.waitForTimeout(600);
  await expect(failureToast(page)).toHaveCount(0);
});

test("an unresumable drop shows 连接失败 with its reason, and 重试连接 delivers again", async ({ page }) => {
  await openApp(page, "#session=A");

  // No cursor is recorded before the drop, so the loop has nothing to resume
  // from: it commits `refused` — the terminal state the retry button exists
  // for. This is the drop-a-dead-server shape.
  await startTurn(page, "A", "hello");
  await dropStream(page, "A");

  const toast = failureToast(page);
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-connection-state", "failed");
  await expect(toast).toContainText("连接失败");
  // The real reason, not the generic detail: the transport's own message for
  // a socket that died mid-stream.
  await expect(toast).toContainText("WebUI connection closed before [DONE]");

  // The manual arm. One click reopens the stream from persisted history…
  const retry = toast.getByRole("button", { name: /重试连接/u });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(failureToast(page)).toHaveCount(0);

  // …and the recovered subscription actually delivers: a frame emitted on the
  // reopened stream lands in the transcript. A notice that only repaints would
  // pass everything above.
  await emitStream(page, "A", {
    cursor: "c2",
    dataJson: JSON.stringify({
      type: "agent_message",
      agent_message: { msgId: "m-recovered", msgContent: "重试后恢复的回复" },
    }),
  });
  await page.evaluate(() => window.__fixture.setPage("A", {
    messages: [{
      msgId: "m-recovered",
      role: "assistant",
      msgContent: "重试后恢复的回复",
      timestamp: 1_700_000_000_200,
    }],
    hasMore: false,
  }));
  await emitStream(page, "A", { dataJson: "[DONE]" });
  await expect(page.getByText("重试后恢复的回复")).toBeVisible();
});
