// The shared toast on the built client (ADR 0030).
//
// What only a browser can show is the point of the decision: a failure that
// used to be written into the page is now drawn over the client, it is
// announced as an alert, and — the reason the whole contract exists — it takes
// no room from the page it interrupts.
//
// The contract itself is held by `webui-toast.test.tsx`. This spec pins the
// behaviour that only a rendered document can show.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  await configureFixture(page, () => {
    window.__fixture.setResponse("getMemorySettings", { enabled: true, proactive: false });
    // The quota read fails, so the settings page has something to report.
    window.__fixture.refuseOperation("getUsageQuota", "fixture_refused", "配额读取失败");
  });
  await openApp(page, "#session=A");
});

const settingsDialog = (page) => page.locator('[role="dialog"][aria-label="设置"]');

async function openUsagePage(page) {
  await page.getByTestId("sidebar-user-menu-trigger").click();
  await page.getByTestId("user-menu-settings").click();
  await expect(settingsDialog(page)).toBeVisible();
  await page.locator('.webui-settings-nav [data-menu-key="usage"]').click();
}

test("a failed read is drawn over the client, not written into the page", async ({ page }) => {
  await openUsagePage(page);

  const toast = page.locator("[data-webui-toast-host] [data-webui-toast]");
  await expect(toast).toBeVisible();

  // The notice interrupts: a failure the user does not hear is a failure that
  // happens again.
  await expect(toast).toHaveAttribute("role", "alert");

  // The page no longer carries the failure. The notice replaced the inline
  // error block, and the retry that used to sit inside it now sits in the
  // notice.
  await expect(page.locator(".webui-settings-content .webui-feedback--error")).toHaveCount(0);
  await expect(toast.getByRole("button", { name: "重试" })).toBeVisible();
});

test("the notice takes no room from the page it interrupts", async ({ page }) => {
  await openUsagePage(page);

  const host = page.locator("[data-webui-toast-host]");
  const toast = page.locator("[data-webui-toast-host] [data-webui-toast]");
  await expect(toast).toBeVisible();

  // The stack is drawn against the window, so it cannot push the content it
  // covers: it is fixed, and it lives outside the application root.
  await expect(host).toHaveCSS("position", "fixed");
  expect(await host.evaluate((element) => element.parentElement?.tagName ?? "")).toBe("BODY");

  // The column sits where it sat before the notice arrived, and it sits there
  // again once the notice is gone. A notice that had taken layout space would
  // have moved it.
  const column = page.locator(".webui-settings-content");
  const withNotice = await column.boundingBox();
  expect(withNotice).toBeTruthy();

  await toast.getByRole("button", { name: "关闭" }).click();
  await expect(toast).toHaveCount(0);

  const withoutNotice = await column.boundingBox();
  expect(withoutNotice?.y).toBe(withNotice?.y);
  expect(withoutNotice?.height).toBe(withNotice?.height);
});

test("the notice crosses the dialog it is drawn over", async ({ page }) => {
  await openUsagePage(page);

  const host = page.locator("[data-webui-toast-host]");
  const toast = page.locator("[data-webui-toast-host] [data-webui-toast]");
  await expect(toast).toBeVisible();

  // A modal makes the page behind it inert, and an inert subtree is gone from
  // the accessibility tree as well: the alert would be drawn and never heard.
  // The notice channel stays live across the modal.
  await expect(host).not.toHaveAttribute("inert", "");

  // The dialog that reported the failure is still the dialog the notice is
  // drawn over. Answering the notice must not close it.
  await expect(settingsDialog(page)).toBeVisible();
  await toast.getByRole("button", { name: "关闭" }).click();
  await expect(toast).toHaveCount(0);
  await expect(settingsDialog(page)).toBeVisible();
});