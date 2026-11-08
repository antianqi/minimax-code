// The account page's calendar tip, measured in the browser.
//
// The shared tooltip owns the visibility, the accessibility and the motion.
// The appearance is the caller's, and it is named rather than spelled: the
// bubble is the one dark shape with an arrow, the card is a plain surface for
// a tip that carries more than a line.
//
// The tip used to be a bubble whatever it wanted to be: the component added
// the bubble's shape to every caller, and the caller then corrected it in its
// own stylesheet. So the tip drew the bubble's ARROW under a card that had
// no arrow to draw. These cases look at the rendered tip — its shape, its
// ink, its padding and its arrow — in both themes.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

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

function settingsDialog(page) {
  return page.locator('[role="dialog"][aria-label="设置"]');
}

/** Opens the settings dialog the way a user does. */
async function openSettings(page) {
  await page.locator('[data-testid="sidebar-user-menu-trigger"]').click();
  await page.locator('[data-testid="user-menu-settings"]').click();
  await expect(settingsDialog(page)).toBeVisible();
}

/** Opens the account page, where the usage calendar is drawn. */
async function openAccountPage(page) {
  await openApp(page, "#session=A");
  await openSettings(page);
  await page.locator('.webui-settings-nav [data-menu-key="account"]').click();
  await expect(page.locator('[data-testid="account-usage-settings"]')).toBeVisible();
}

/** The tip the calendar draws over the cell under the pointer. */
function calendarTip(page) {
  return page.locator(".webui-account-usage-cell-tip");
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  await configureFixture(page, () => {
    window.__fixture.setResponse("getAccountUsageSummary", { days: [] });
  });
});

test("the calendar tip is the shared card, and not a bubble with an arrow", async ({ page }) => {
  await openAccountPage(page);
  const cell = page.locator('button[data-testid^="usage-cell-"]').first();
  await expect(cell).toBeVisible();
  const tip = calendarTip(page);
  await expect(tip).toHaveCount(1);

  await cell.hover();
  await expect(tip).toHaveAttribute("data-webui-tooltip-visible", "true");

  // The card is named, and the bubble is not: the tip is not a bubble that
  // had its internals corrected.
  await expect(tip).toHaveClass(/webui-tooltip-card/);
  await expect(tip).not.toHaveClass(/webui-tooltip-bubble/);

  // And the bubble's arrow is not under it. The bubble draws its arrow with a
  // pseudo-element, so the card has to have none at all.
  const arrow = await tip.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return { content: style.content, borderTopColor: style.borderTopColor };
  });
  expect(arrow.content).toBe("none");
});

test("the calendar tip keeps the geometry it always had", async ({ page }) => {
  await openAccountPage(page);
  const cell = page.locator('button[data-testid^="usage-cell-"]').first();
  await cell.hover();
  const tip = calendarTip(page);
  await expect(tip).toHaveAttribute("data-webui-tooltip-visible", "true");

  const shape = await tip.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: style.borderRadius,
      background: style.backgroundColor,
      padding: style.padding,
      color: style.color,
      fontSize: style.fontSize,
      pointerEvents: style.pointerEvents,
      position: style.position,
      zIndex: style.zIndex,
    };
  });
  // The card's own shape: a 4px radius, the bubble's dark ink, 8px/10px of
  // padding and the inverted text colour. The placement is the tip's.
  expect(shape.borderRadius).toBe("4px");
  expect(shape.background).toBe("rgba(0, 0, 0, 0.85)");
  expect(shape.padding).toBe("8px 10px");
  expect(shape.color).toBe("rgba(255, 255, 255, 0.95)");
  expect(shape.pointerEvents).toBe("none");
  expect(shape.position).toBe("fixed");
  expect(shape.zIndex).toBe("130");
});

for (const theme of ["light", "dark"]) {
  test(`the calendar tip is drawn in the ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openAccountPage(page);
    const cell = page.locator('button[data-testid^="usage-cell-"]').first();
    await cell.hover();
    const tip = calendarTip(page);
    await expect(tip).toHaveAttribute("data-webui-tooltip-visible", "true");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(theme === "dark");
    if (evidenceDir) {
      await page.screenshot({ path: `${evidenceDir}/usage-heatmap-tip-${theme}.png` });
      await tip.screenshot({ path: `${evidenceDir}/usage-heatmap-tip-${theme}-detail.png` });
    }
  });
}
