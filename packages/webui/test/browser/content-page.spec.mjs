// The pages that render the content page frame, measured after the migration
// (#291, ADR 0028 § Shared contracts).
//
// The frame's own claims are tested without a browser in `content-page.test.ts`.
// What a string cannot show is what the AC asks for: over each migrated page's
// enumerated states — two viewports, both themes — nothing is squeezed, deformed,
// truncated or reflowed, and the page keeps exactly one scroll boundary, on the
// element the contract names rather than on whatever happens to overflow.
//
// The theme is switched the way a user switches it, through 设置 › 通用, because
// the suite pins `colorScheme: "light"` and the client's theme is an explicit
// preference rather than a media query.
//
// The fixture exposes both the remote page and SSH connection settings. Missing
// routes or controls fail these deterministic scenarios rather than skipping them.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

const VIEWPORTS = [
  { name: "wide", width: 1440, height: 900, railMode: "column" },
  { name: "narrow", width: 390, height: 844, railMode: "drawer" },
];
const THEMES = ["light", "dark"];

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  await configureFixture(page, () => {
    window.__fixture.setResponse("listSshConnections", []);
    window.__fixture.setResponse("listSshProjects", []);
  });
  await openApp(page, "#session=A");
});

const settingsDialog = (page) => page.locator('[role="dialog"][aria-label="设置"]');

/** Switches the client theme through the settings page, the way a user does. */
async function setTheme(page, theme) {
  await page.getByTestId("sidebar-user-menu-trigger").click();
  await page.getByTestId("user-menu-settings").click();
  await expect(settingsDialog(page)).toBeVisible();
  await page.locator('[data-testid="mavis-settings-appearance-row"] .mavis-settings-theme-option', {
    hasText: theme === "dark" ? "深色模式" : "浅色模式",
  }).click();
  // The settings modal is a managed layer now, so one Escape closes it.
  await page.keyboard.press("Escape");
  await expect(settingsDialog(page)).toHaveCount(0);
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  expect(isDark, `${theme} theme applied`).toBe(theme === "dark");
}

/**
 * What the frame promises about the page it holds.
 *
 * The scroll boundary is counted by contract — the elements that declare
 * `overflow-y: auto` — not by whether today's content happens to overflow: a page
 * whose content fits still owns exactly one boundary.
 */
async function measure(page, selector) {
  return page.evaluate((pageSelector) => {
    const section = document.querySelector(pageSelector);
    if (!section) return null;
    // The page's body is the layout it renders inside; on a two-pane page that
    // layout does not sit under the pane's own header, so the caller says which
    // element stands for the body.
    const header = section.querySelector("header");
    const body = section.querySelector("[data-webui-scheduling-layout], [data-webui-page-body]") ?? section.lastElementChild;
    const scrollers = [section, ...section.querySelectorAll("*")].filter(
      (node) => getComputedStyle(node).overflowY === "auto",
    );
    const heading = header?.querySelector("h1");
    const headingBox = heading?.getBoundingClientRect();
    const headerBox = header?.getBoundingClientRect();
    const bodyBox = body?.getBoundingClientRect();
    return {
      pageScrolls: getComputedStyle(section).overflowY === "auto",
      scrollingNodes: scrollers.length,
      headerHeight: headerBox ? Math.round(headerBox.height) : null,
      headerBorder: header ? getComputedStyle(header).borderBottomWidth : null,
      titlePresent: Boolean(heading),
      // A clipped title loses height; a squeezed one loses width.
      titleHeight: headingBox ? Math.round(headingBox.height) : null,
      titleWidth: headingBox ? Math.round(headingBox.width) : null,
      headerWidth: headerBox ? Math.round(headerBox.width) : null,
      horizontalOverflow: section.scrollWidth - section.clientWidth,
      bodyBelowHeader: headerBox && bodyBox ? bodyBox.top >= headerBox.bottom - 1 : null,
      bodyHasHeight: bodyBox ? Math.round(bodyBox.height) : null,
    };
  }, selector);
}

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    test(`定时任务 holds the frame at ${viewport.name} / ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openApp(page, "#session=A");
      await setTheme(page, theme);
      await page.getByRole("button", { name: /定时任务/u }).first().click();
      // The page is measured at the enumerated viewport; it is *reached* at the wide
      // one, where the rail's rows are on screen.
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // ResizeObserver commits the shell's mode after the viewport changes.
      // Measure the content once the rail has handed its column width back.
      await expect(page.locator('[data-webui-shell="two-column"]')).toHaveAttribute("data-webui-rail-mode", viewport.railMode);
      const panel = page.locator('[data-webui-component="scheduling-panel"]');
      await expect(panel).toBeVisible();

      const measured = await measure(page, '[data-webui-component="scheduling-panel"]');
      expect(measured, "panel rendered").not.toBeNull();
      expect(measured?.pageScrolls, "the page itself does not scroll").toBe(false);
      // The page is two panes (the task list and the selected task), and each
      // pane owns its own boundary while the frame itself never scrolls.
      expect(measured?.scrollingNodes, "one scroll boundary per pane").toBe(2);
      expect(measured?.headerHeight ?? 0, "the header keeps its height").toBeGreaterThan(40);
      expect(measured?.titleHeight ?? 0, "the title is not clipped vertically").toBeGreaterThanOrEqual(18);
      expect(measured?.titleWidth ?? 0, "the title keeps its width").toBeGreaterThan(20);
      expect(measured?.horizontalOverflow ?? 1, "no sideways overflow").toBeLessThanOrEqual(0);
      // The page is two panes side by side (stacked at narrow widths), so the
      // body is the layout that holds both of them rather than a block under one
      // header — and it is the layout that fills what the frame leaves.
      expect(measured?.bodyHasHeight ?? 0, "the body fills what is left").toBeGreaterThan(0);
    });

    test(`远程 holds the frame at ${viewport.name} / ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openApp(page, "#session=A");
      await setTheme(page, theme);

      const railRow = page.getByRole("button", { name: /^远程$/u }).first();
      // The runtime decides whether the client has a remote page; a disabled row is
      // not a page, so there is nothing to measure and nothing to claim.
      await expect(railRow).toBeEnabled();
      await railRow.click();
      await expect(page.getByTestId("remote-page")).toBeVisible();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(page.locator('[data-webui-shell="two-column"]')).toHaveAttribute("data-webui-rail-mode", viewport.railMode);

      const measured = await measure(page, '[data-testid="remote-page"]');
      expect(measured?.pageScrolls, "the remote page does not scroll as a page").toBe(false);
      // Its header is a tab bar rather than a title row: it keeps its own height.
      expect(measured?.headerHeight ?? 0).toBeGreaterThanOrEqual(44);
      expect(measured?.horizontalOverflow ?? 1, "no sideways overflow").toBeLessThanOrEqual(0);
      expect(measured?.bodyHasHeight ?? 0, "the body fills what is left").toBeGreaterThan(0);

      // SSH is exposed through connection settings, not a tab of the remote page.
      await page.getByTestId("remote-control-settings-entry").click();
      const sshTab = page.getByTestId("connection-section-ssh");
      await expect(sshTab).toBeVisible();
      await sshTab.click();
      const sshPanel = page.locator('[data-webui-component="ssh-panel"]');
      await expect(sshPanel).toBeVisible();
      const ssh = await sshPanel.evaluate((element) => {
        const dialog = element.closest('[role="dialog"]');
        const body = dialog.querySelector(".webui-settings-content");
        return {
          width: element.getBoundingClientRect().width,
          overflow: element.scrollWidth - element.clientWidth,
          bodyOverflow: getComputedStyle(body).overflowY,
          headerHeight: dialog.querySelector("header").getBoundingClientRect().height,
        };
      });
      expect(ssh.width).toBeGreaterThan(0);
      expect(ssh.overflow, "SSH content fits its settings viewport").toBeLessThanOrEqual(0);
      expect(ssh.bodyOverflow, "the settings body owns scrolling").toBe("auto");
      expect(ssh.headerHeight, "settings retains its header").toBeGreaterThan(0);
      await page.screenshot({ path: test.info().outputPath(`ssh-settings-${viewport.name}-${theme}.png`), animations: "disabled" });
    });
  }
}
