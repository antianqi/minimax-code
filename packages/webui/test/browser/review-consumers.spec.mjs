// The review consumers, against the built client (T10's verification seam:
// "transcript/workspace review browser consumers").
//
// The transcript's diff card reads a turn through the review owner — the owner
// asks the runtime, and the card shows what came back — and a revert the owner
// settles is announced so the workspace review family refreshes. Unit tests pin
// the owner's decisions; these cases pin that the surfaces are actually wired to
// it.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";

import { configureFixture, openApp, switchSession, test } from "./harness.mjs";

/** An assistant message carrying a turn diff, which is what makes the transcript
 *  render its diff card. */
const diffMessage = {
  msgId: "assistant-diff",
  role: "assistant",
  msgContent: "改好了",
  timestamp: 1_700_000_000_500,
  fileChanges: [{ file: "a.ts", additions: 2, deletions: 1 }],
  changeSetId: "cs-1",
  sourceMessageId: "assistant-diff",
  canUndo: true,
  turnDiffStatus: "active",
};

const requests = (page, operation) =>
  page.evaluate(
    (name) => window.__fixture.requests.filter((request) => request.operation === name).length,
    operation,
  );

/** Boot, seed the diff-bearing page, and re-enter the session so the transcript
 *  reads it. */
async function openSessionWithDiff(page) {
  await configureFixture(page, () => undefined);
  await openApp(page);
  await page.evaluate((message) => {
    window.__fixture.setPage("A", { messages: [message], hasMore: false });
  }, diffMessage);
  await switchSession(page, "B");
  await switchSession(page, "A");
}

test("the diff card reads its turn through the review owner", async ({ page }) => {
  await openSessionWithDiff(page);
  const card = page.locator('[data-testid="turn-diff-card"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("a.ts");
  // The card did not fetch this itself: the owner did, on the card's behalf.
  await expect.poll(() => requests(page, "getTurnDiff")).toBeGreaterThan(0);
});

test("the diff card header hover reaches the card's inner right edge", async ({ page }) => {
  await openSessionWithDiff(page);
  const card = page.locator('[data-testid="turn-diff-card"]');
  const header = card.locator(".webui-diff-header");
  await expect(header).toBeVisible();
  await header.hover();
  await expect
    .poll(() => header.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe("rgba(0, 0, 0, 0)");

  const geometry = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="turn-diff-card"]');
    const header = card?.querySelector(".webui-diff-header");
    if (!card || !header) return null;
    const cardBounds = card.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const style = getComputedStyle(card);
    return {
      rightGap: cardBounds.right - headerBounds.right,
      cardBorderRight: Number.parseFloat(style.borderRightWidth),
    };
  });

  expect(geometry).not.toBeNull();
  expect(Math.abs(geometry.rightGap - geometry.cardBorderRight)).toBeLessThanOrEqual(0.5);
});

test("an outside-workspace review entry opens that file in the workspace viewer on request", async ({ page }) => {
  await configureFixture(page, () => undefined);
  await openApp(page);
  const outsidePath = "/synthetic/session-artifacts/generated/flower.svg";
  await page.evaluate((path) => {
    window.__fixture.setPage("A", {
      messages: [{
        msgId: "outside-review",
        role: "assistant",
        msgContent: "已修改",
        timestamp: 1_700_000_000_500,
        fileChanges: [{ file: path, additions: 1, deletions: 0 }],
        changeSetId: "outside-cs",
        sourceMessageId: "outside-review",
        turnDiffStatus: "active",
      }],
      hasMore: false,
    });
    window.__fixture.setTurnDiff({
      status: "active",
      changeSetId: "outside-cs",
      sourceMessageId: "outside-review",
      canUndo: false,
      canReapply: false,
      fileChanges: [{ file: path, additions: 1, deletions: 0, diff: "@@ -0,0 +1 @@\\n+synthetic withheld body" }],
    });
  }, outsidePath);
  await switchSession(page, "B");
  await switchSession(page, "A");
  await page.getByTestId("turn-diff-review").click();

  const unavailable = page.getByTestId("turn-review-outside-workspace");
  await expect(unavailable).toContainText("该文件在工作区之外，内容未展示。");
  await expect(unavailable).not.toContainText("synthetic withheld body");
  await unavailable.getByTestId("turn-review-open-outside-file").click();

  const preview = page.getByTestId("workspace-file-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("export const answer = 42;");
  const read = await page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "readWorkspaceFile").at(-1));
  expect(read.body).toEqual({ workspaceDir: "/synthetic/session-artifacts/generated", path: "flower.svg" });
});

test("a revert the owner settles is what the card shows", async ({ page }) => {
  await openSessionWithDiff(page);
  const card = page.locator('[data-testid="turn-diff-card"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-webui-diff-state", "active");

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("turn-diff-undo").click();
  await expect.poll(() => requests(page, "revertTurnDiff")).toBeGreaterThan(0);
  // The reverted view comes back through the owner, not from a local guess.
  await expect(card).toHaveAttribute("data-webui-diff-state", "reverted");
  await expect(page.getByTestId("turn-diff-undo")).toContainText("重新应用");
});

test("a settled revert refreshes the workspace review family", async ({ page }) => {
  await openSessionWithDiff(page);
  // The review tab opens from the browser panel's new tab page.
  await page
    .getByTestId("workspace-panel-controls")
    .getByRole("button", { name: "浏览器" })
    .click();
  await page.getByTestId("workspace-launcher-tile-review").click();
  await expect(page.getByTestId("workspace-review")).toBeVisible();
  await expect.poll(() => requests(page, "getWorkspaceReviewSummary")).toBeGreaterThan(0);
  const changeSearch = page.getByRole("searchbox", { name: "搜索变更" });
  await expect(changeSearch).toBeVisible();
  const searchGeometry = await changeSearch.locator("xpath=ancestor::div[contains(@class, 'webui-search-field')]").evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return { borderRadius: Number.parseFloat(style.borderTopLeftRadius), height: bounds.height };
  });
  expect(searchGeometry.borderRadius).toBeGreaterThanOrEqual(searchGeometry.height / 2);
  const captureDir = process.env.WEBUI_REVIEW_SEARCH_SCREENSHOT_DIR;
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    await page.screenshot({ path: join(captureDir, "workspace-review-search.png"), fullPage: true });
  }
  await changeSearch.fill("a.ts");
  // The review toolbar carries a search field now, and the field submits on
  // Enter rather than through a button beside it.
  await changeSearch.press("Enter");
  await expect.poll(() => requests(page, "searchWorkspaceReviewDiffs")).toBeGreaterThan(0);
  const before = await requests(page, "getWorkspaceReviewSummary");

  // The revert settles in the turn family and announces it; the review family is
  // invalidated and re-reads the working tree it just changed (plan §4.5).
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("turn-diff-undo").click();
  await expect.poll(() => requests(page, "revertTurnDiff")).toBeGreaterThan(0);
  await expect
    .poll(() => requests(page, "getWorkspaceReviewSummary"))
    .toBeGreaterThan(before);
});
