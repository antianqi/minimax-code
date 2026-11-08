// The API key panel's feedback, measured in the browser.
//
// A key operation has already happened by the time it is reported: the test
// ran, the save landed or did not. ADR 0030 says such a thing is said through
// the shared toast, over the client, and it takes no room from the page it is
// about. The panel used to write the result into the page instead, under the
// field.
//
// Two kinds of feedback are therefore told apart here, and the distinction is
// the whole point: the field's OWN validation error stays with the field, in
// place, because it is about the control the user is still typing in; the
// operation's result is said over the client, because it is about something
// that has already happened.

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

function settingsDialog(page) {
  return page.locator('[role="dialog"][aria-label="设置"]');
}

/** Opens the usage panel, where the API key field is. */
async function openUsagePanel(page) {
  await openApp(page, "#session=A");
  await page.locator('[data-testid="sidebar-user-menu-trigger"]').click();
  await page.locator('[data-testid="user-menu-settings"]').click();
  await expect(settingsDialog(page)).toBeVisible();
  await page.locator('.webui-settings-nav [data-menu-key="usage"]').click();
  // The source picker chooses which source the panel is about; the API key
  // belongs to the MiniMax API source.
  await page.getByTestId("settings-usage-source-dropdown").click();
  await page.getByRole("menuitem", { name: "MiniMax API" }).click();
  await expect(page.getByTestId("settings-minimax-api-panel")).toBeVisible();
}

/** The panel the key belongs to. */
function apiKeyPanel(page) {
  return page.getByTestId("settings-minimax-api-panel");
}

/** The notice about the key's own operation. */
function keyResultToast(page) {
  return page.locator('[data-webui-toast="true"]', { hasText: "连接失败" });
}

/**
 * Any notice that reports the outcome of a connection test.
 *
 * The panel's own reads say notices of their own — the key's status cannot be
 * read in the fixture, and that notice belongs to the panel — so the number of
 * notices on screen says nothing about what the operation under test said.
 * What matters is whether an OPERATION was reported: a connection test that
 * never ran must leave no outcome behind.
 */
function connectionOutcomeToast(page) {
  return page.locator('[data-webui-toast="true"]', { hasText: /连接(成功|失败)/u });
}

test("a failed connection test is said over the client, not written into the page", async ({ page }) => {
  await openUsagePanel(page);
  const panel = apiKeyPanel(page);

  await panel.getByPlaceholder("请输入API Key").fill("synthetic-key");
  await panel.getByRole("button", { name: "测试连通性" }).click();

  // The toast is drawn over the client, in the client's own queue, and it
  // carries the failure.
  await expect(keyResultToast(page)).toHaveCount(1);
  await expect(keyResultToast(page)).toHaveAttribute("data-webui-toast-tone", "error");

  // And the panel itself says nothing: the result does not take room from the
  // page it is about, and it does not outlive the moment it is about.
  await expect(panel.locator('[role="status"]')).toHaveCount(0);
  await expect(panel.locator('[aria-live]')).toHaveCount(0);
  if (evidenceDir) {
    await page.screenshot({ path: `${evidenceDir}/api-key-toast.png` });
  }
});

test("the field's own validation error stays with the field", async ({ page }) => {
  await openUsagePanel(page);
  const panel = apiKeyPanel(page);

  // An empty key is not an operation that failed: nothing was tried. The
  // message belongs to the control, and it is addressable by it.
  await panel.getByRole("button", { name: "测试连通性" }).click();
  const field = panel.locator("input[type='password']");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await field.getAttribute("aria-describedby")) ?? "";
  expect(describedBy).not.toBe("");
  await expect(panel.locator('[role="alert"]')).toHaveCount(1);

  // Nothing was said about the operation over the client: there was no
  // operation to report, so no outcome may be on screen.
  await expect(connectionOutcomeToast(page)).toHaveCount(0);
});

test("the same answer twice is heard twice", async ({ page }) => {
  await openUsagePanel(page);
  const panel = apiKeyPanel(page);

  await panel.getByPlaceholder("请输入API Key").fill("synthetic-key");
  await panel.getByRole("button", { name: "测试连通性" }).click();
  await expect(keyResultToast(page)).toHaveCount(1);

  // The notice that is already on screen is refreshed in place rather than
  // stacked, and it is heard again: the card's message is replaced, so the
  // live region announces the same words again.
  const first = await keyResultToast(page).locator(".webui-toast-message").elementHandle();
  await panel.getByRole("button", { name: "测试连通性" }).click();
  await expect(keyResultToast(page)).toHaveCount(1);
  const second = await keyResultToast(page).locator(".webui-toast-message").elementHandle();
  // The card is refreshed in place — there is still one notice — but its
  // message is a new element: a live region only announces what changed
  // inside it, so the second saying has to replace the words to be heard.
  expect(
    await first.evaluate((node) => node.isConnected),
    "the first message element is gone",
  ).toBe(false);
  expect(await second.evaluate((node) => node.isConnected)).toBe(true);
  expect(
    await first.evaluate((node, other) => node !== other, second),
    "the message element is replaced, so the region announces it again",
  ).toBe(true);
});

test("a successful connection test is said over the client", async ({ page }) => {
  // The fixture answers the connectivity test with a success this time: the
  // client's own failure path is not the only one that has to be said.
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setResponse("testUserModelProvider", { success: true, status: { ok: true } });
    });
  });
  await openUsagePanel(page);
  const panel = apiKeyPanel(page);

  await panel.getByPlaceholder("请输入API Key").fill("synthetic-key");
  await panel.getByRole("button", { name: "测试连通性" }).click();

  const success = page.locator('[data-webui-toast="true"]', { hasText: "连接成功" });
  await expect(success).toHaveCount(1);
  await expect(success).toHaveAttribute("data-webui-toast-tone", "success");
  // And the panel itself says nothing: the result does not take room from
  // the page it is about.
  await expect(panel.locator('[role="status"]')).toHaveCount(0);
  await expect(panel.locator('[aria-live]')).toHaveCount(0);
});

test("a save the runtime refuses is said over the client", async ({ page }) => {
  // A refusal is the runtime's answer, and it is an answer about something
  // that has already happened: it is said over the client, not under the
  // field.
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.refuseOperation("upsertMiniMaxApiKey", "permission_denied", "没有权限保存 API Key。");
    });
  });
  await openUsagePanel(page);
  const panel = apiKeyPanel(page);

  await panel.getByPlaceholder("请输入API Key").fill("synthetic-key");
  await panel.getByRole("button", { name: "保存并使用" }).click();

  const refused = page.locator('[data-webui-toast="true"]', { hasText: "没有权限保存 API Key。" });
  await expect(refused).toHaveCount(1);
  await expect(refused).toHaveAttribute("data-webui-toast-tone", "error");
  await expect(panel.locator('[role="status"]')).toHaveCount(0);
});

test("the same answer again is given the full time again", async ({ page }) => {
  await openUsagePanel(page);
  const panel = apiKeyPanel(page);

  await panel.getByPlaceholder("请输入API Key").fill("synthetic-key");
  await panel.getByRole("button", { name: "测试连通性" }).click();
  await expect(keyResultToast(page)).toHaveCount(1);

  // An error notice lives for six seconds. The answer is repeated near the
  // end of that, and the second saying is news: the card is refreshed and it
  // is given the time a new notice gets, so it does not vanish half a second
  // after the second answer.
  await page.waitForTimeout(5000);
  await panel.getByRole("button", { name: "测试连通性" }).click();
  await expect(keyResultToast(page)).toHaveCount(1);

  await page.waitForTimeout(2000);
  // Seven seconds after the first answer, and the notice is still there: its
  // countdown started again with the second answer.
  await expect(keyResultToast(page)).toHaveCount(1);
});

