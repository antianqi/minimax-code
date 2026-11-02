// Three surfaces that the browser suite could not reach, and that a human could
// not get past either.
//
// The shared root is one line of the transport: `resolve(frame.body as T)`.
// The server's body reaches the component verbatim, so every consumer
// inherits the server's shape with nothing in between. The browser fixture
// answered every unknown operation with `return {}`, and each of these three
// consumers read a nested field off that `{}` without a guard:
//
//   sign-in   account-workflows -> setSignin({ panel }) -> the sign-in view's
//             `[...days]` -> `days is not iterable`
//   workspace workspace-files-owner -> setListing -> `listing?.entries.length`
//             -> `Cannot read properties of undefined (reading 'length')`
//   permission setPermissionMode was a no-op while getPermissionMode always
//             answered "default", so the write-then-read-back check in
//             `changePermissionMode` could never pass and every mode but
//             `default` raised 「授权模式未能保存，请重试」
//
// Each one is an error BOUNDARY trip: the whole app tree is replaced, not one
// row. So the assertion that matters is the negative — the boundary must stay
// out of the page — plus the positive that the surface actually rendered.

import { expect } from "@playwright/test";

import { openApp, test } from "./harness.mjs";

const boundary = (page) => page.locator('[data-testid="webui-error-boundary"]');

async function openUserMenu(page) {
  await page.locator('[data-testid="sidebar-user-menu-trigger"]').click();
  await expect(page.locator(".webui-user-menu-uid")).toBeVisible();
}

test("the sign-in row renders seven days instead of tripping the error boundary", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openApp(page, "#session=A");
  await openUserMenu(page);

  // Hovering the row is what loads the panel (`onMouseEnter` -> loadSignin),
  // so the request is what a real pointer produces.
  await page.locator(".webui-user-menu-signin-anchor").hover();

  await expect(page.locator('[data-testid="signin-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="signin-day-1"]')).toBeVisible();
  await expect(page.locator('[data-testid="signin-day-7"]')).toBeVisible();
  const creditsInfo = page.getByRole("button", { name: "关于签到积分" });
  await creditsInfo.hover();
  const tooltip = page.locator('[role="tooltip"]');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute("data-webui-motion", "tooltip");
  await expect(tooltip).toHaveAttribute("data-webui-tooltip-visible", "true");
  await expect.poll(() => tooltip.evaluate((element) => getComputedStyle(element).transitionDuration))
    .toContain("0.12s");
  await page.locator("[data-testid='signin-card']").hover({ position: { x: 12, y: 12 } });
  await expect(tooltip).toHaveAttribute("aria-hidden", "true");
  await expect(tooltip).toHaveAttribute("inert", "");
  // No error card, and no card-level error panel either: a degraded panel is
  // allowed, a crashed one is not.
  await expect(boundary(page)).toHaveCount(0);
  await expect(page.locator('[data-testid="signin-card-error"]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("the sign-in flyout completes its shared surface exit when another account panel opens", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openApp(page, "#session=A");
  await openUserMenu(page);
  await page.locator(".webui-user-menu-signin-anchor").hover();

  const signinPanel = page.getByRole("dialog", { name: "每日签到" });
  await expect(signinPanel).toHaveAttribute("data-webui-motion-state", "enter");
  await page.evaluate(() => {
    window.__signinFlyoutExitAnimation = undefined;
    document.addEventListener("animationend", (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.classList.contains("webui-user-menu-signin-panel")
      ) {
        window.__signinFlyoutExitAnimation = event.animationName;
      }
    }, { capture: true });
  });

  await page.locator('[data-testid="user-menu-usage"]').click();
  await expect.poll(() => page.evaluate(() => window.__signinFlyoutExitAnimation))
    .toBe("webui-motion-surface-exit");
  await expect(signinPanel).toHaveCount(0);
});

test("the workspace picker opens 选择新项目 without tripping the error boundary", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // The project row renders only on the home surface — the bar is inside
  // `!sessionLayout`. Opening `#session=A` puts the composer in a session,
  // where there is no workspace bar to click at all.
  await openApp(page, "");
  await page.locator(".webui-workspace-bar-trigger").click();
  const chooseNew = page.getByRole("option", { name: "选择新项目" });
  expect(await chooseNew.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0.12s");
  const idleBackground = await chooseNew.evaluate((element) => getComputedStyle(element).backgroundColor);
  await chooseNew.hover();
  await expect.poll(() => chooseNew.evaluate((element) => getComputedStyle(element).backgroundColor))
    .not.toBe(idleBackground);
  await chooseNew.click();

  // The fixture answers an honest listing, and the owner normalises what
  // comes back before the view sees it: a body that is not a listing degrades
  // to an empty directory rather than to a blank page. This is the guard for
  // that — the picker opens either way, and nothing is left in the boundary.
  const browser = page.locator('[data-webui-workspace-browser="true"]');
  await expect(browser).toBeVisible();
  await expect(page.locator(".webui-composer-menu-empty")).toBeVisible();
  await expect(boundary(page)).toHaveCount(0);
  expect(pageErrors).toEqual([]);

  await page.evaluate(() => {
    window.__workspaceBrowserExitAnimation = undefined;
    document.addEventListener("animationend", (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.matches(".webui-workspace-menu--desktop")
      ) {
        window.__workspaceBrowserExitAnimation = event.animationName;
      }
    }, { capture: true });
  });
  await browser.getByRole("button", { name: "取消" }).click();
  await expect.poll(() => page.evaluate(() => window.__workspaceBrowserExitAnimation))
    .toBe("webui-motion-surface-exit");
  await expect(browser).toHaveCount(0);
});

test("choosing a permission mode survives the write-then-read-back check", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await openApp(page, "#session=A");

  const trigger = page.locator('[data-testid="composer-permission-mode"]');
  await trigger.click();
  // The options are plain buttons with no `role="menuitem"`, so they are
  // located by their own class rather than by ARIA role.
  await page.locator(".webui-composer-permission-option", { hasText: "帮我批准" }).click();

  // The verification itself is the subject: `changePermissionMode` writes, then
  // reads back and throws when the two disagree. It is the right pattern — the
  // fixture was the thing that could not satisfy it — so the assertion is that
  // the error message never appears, not that the check was removed.
  await expect(page.getByText("授权模式未能保存")).toHaveCount(0);
  await expect(trigger).toContainText("帮我批准");
  await expect(boundary(page)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("full-access permission trigger colors its label and icon as warning", async ({ page }) => {
  await openApp(page, "#session=A");

  const trigger = page.locator('[data-testid="composer-permission-mode"]');
  await trigger.click();
  await page.locator(".webui-composer-permission-option", { hasText: "完全访问权限" }).click();
  await expect(trigger).toContainText("完全访问权限");

  // Every button transitions `color`, so the colour read in the same tick
  // as the mode landing is still the colour the trigger had before it: the
  // transition has been created but has not advanced. The assertion waits
  // for the transition to settle rather than reading one frame after the
  // change, which is what made this fail whenever the browser had not
  // painted a frame in between.
  const warning = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text_status_warning)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect
    .poll(() => trigger.evaluate((button) => getComputedStyle(button).color))
    .toBe(warning);

  const colors = await trigger.evaluate((button) => {
    const label = button.querySelector(".webui-composer-permission-label");
    const icon = button.querySelector(".webui-composer-permission-icon");
    return {
      button: getComputedStyle(button).color,
      label: getComputedStyle(label).color,
      icon: getComputedStyle(icon).color,
    };
  });

  expect(colors.label).toBe(colors.button);
  expect(colors.icon).toBe(colors.button);
});
