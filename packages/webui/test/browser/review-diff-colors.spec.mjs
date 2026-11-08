// The diff rows, drawn.
//
// A diff row is a status wash with ink on it. The ink used to be a hardcoded
// dark green or a hardcoded dark red: readable on the light theme's pale
// wash, and invisible on the dark theme's, where the wash is a deep green and
// a deep red. The ink is the theme's primary text now.
//
// This is the rendered measurement: the colours the browser resolved on the
// rows that are actually on the screen, and the contrast between them, in
// both themes. The compiled CSS says what was asked for; this says what the
// reader gets.

import { expect } from "@playwright/test";

import { openApp, test } from "./harness.mjs";

/**
 * Where the evidence run writes its screenshots.
 *
 * The repository keeps no screenshots: the evidence belongs outside the
 * checkout, so the directory is named by the environment and the capture is
 * skipped when it is not set.
 */
const evidenceDir = process.env.WEBUI_AUDIT_EVIDENCE_DIR;

/** The theme the client boots in, for the run that asks for one. */
async function useTheme(page, theme) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("webui-theme", value);
  }, theme);
}

/** One file with an added line and a removed line. */
const FILE = {
  fileId: "src/changed.ts",
  path: "src/changed.ts",
  additions: 1,
  deletions: 1,
  status: "modified",
};

const DIFF = [
  "diff --git a/src/changed.ts b/src/changed.ts",
  "--- a/src/changed.ts",
  "+++ b/src/changed.ts",
  "@@ -1,2 +1,2 @@",
  " const kept = 1;",
  "-const removed = 2;",
  "+const added = 3;",
].join("\n");

/** Opens the review in the workspace panel. */
async function openReview(page) {
  await openApp(page, "#session=A");
  await page.getByTestId("workspace-panel-controls").getByRole("button", { name: "浏览器" }).click();
  await page.getByTestId("workspace-launcher-tile-review").click();
  const review = page.getByTestId("workspace-review");
  await expect(review).toBeVisible();
  return review;
}

/**
 * The contrast between two computed colours.
 *
 * Computed in the page from the colours the browser resolved: a token's value
 * is not what a surface ends up being.
 */
async function contrast(page, first, second) {
  return page.evaluate(
    ([a, b]) => {
      const channels = (value) => (value.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
      const luminance = (rgb) => {
        const [r, g, b2] = rgb.map((channel) => {
          const c = channel / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
      };
      const first2 = luminance(channels(a));
      const second2 = luminance(channels(b));
      return (Math.max(first2, second2) + 0.05) / (Math.min(first2, second2) + 0.05);
    },
    [first, second],
  );
}

/** The colours a drawn row carries. */
async function rowColours(page, selector) {
  return page.locator(selector).first().evaluate((element) => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }));
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  await page.addInitScript((value) => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => window.__fixture.setWorkspaceReview(value.summary, value.diffs));
  }, {
    summary: {
      repositoryId: "repo-1",
      reviewSnapshotId: "colour-snapshot",
      files: [FILE],
      totals: { files: 1, additions: 1, deletions: 1 },
    },
    diffs: [{ fileId: FILE.fileId, diff: { type: "text", diff: DIFF } }],
  });
});

for (const theme of ["light", "dark"]) {
  test(`the changed rows are readable in the ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    const review = await openReview(page);

    const addition = review.locator(".webui-turn-review-line--addition");
    const deletion = review.locator(".webui-turn-review-line--deletion");
    await expect(addition).toHaveCount(1);
    await expect(deletion).toHaveCount(1);

    // The rows are drawn: the added line and the removed one are on screen,
    // with the text they carry.
    await expect(addition).toContainText("const added = 3;");
    await expect(deletion).toContainText("const removed = 2;");

    // The ink on the wash is readable. The old hardcoded ink measured 1.02:1
    // on the dark theme's wash; the theme's primary text measures far more
    // than the 4.5:1 that text needs.
    const added = await rowColours(page, ".webui-turn-review-line--addition");
    const removed = await rowColours(page, ".webui-turn-review-line--deletion");
    expect(await contrast(page, added.color, added.background)).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, removed.color, removed.background)).toBeGreaterThanOrEqual(4.5);

    // And the two washes are the theme's own status washes, not hardcoded
    // colours.
    expect(added.background).not.toBe(removed.background);

    if (evidenceDir) {
      await page.screenshot({ path: `${evidenceDir}/review-diff-${theme}.png` });
    }
  });
}
