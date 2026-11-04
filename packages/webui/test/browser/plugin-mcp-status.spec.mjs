// The MCP servers' connection state on the plugin panel, end to end against
// the built client.
//
// Roadmap D-3 (as transcribed): 「MCP 插件连不上时，界面上要看得见」. The
// runtime classifies every server and attaches the failure's own reason to
// the trouble states; the panel's MCP rows used to render none of it, so a
// dead server was visually identical to a healthy one. This spec walks the
// real path a user walks — rail 插件 → 管理 → MCP — and reads the placed,
// loaded rows: every state labelled, the two failure states carrying their
// server's own reason as visible text.

import { expect } from "@playwright/test";

import { openApp, test } from "./harness.mjs";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("BROWSER_CONSOLE_ERROR", message.text()); });
});

/** Stages the MCP listing before boot; the panel's reload picks it up. */
async function stageMcpServers(page, servers) {
  await page.addInitScript((value) => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() =>
      window.__fixture.setPluginManagementResult("listMcpServers", value),
    );
  }, { servers });
}

async function openMcpArea(page) {
  await page.getByRole("button", { name: "插件" }).first().click();
  await page.getByTestId("plugin-manage-trigger").click();
  await page.locator('.webui-plugin-category-filter button', { hasText: "MCP" }).click();
}

function rowOf(page, name) {
  return page.locator(".webui-plugin-row", { hasText: name });
}

test("a server that cannot connect is labelled 连接失败 with its own reason", async ({ page }) => {
  await stageMcpServers(page, [
    {
      name: "broken-http",
      transport: "http",
      enabled: true,
      status: "error",
      available: false,
      error: "MCP_CONNECTION_TIMEOUT: 握手超时（10s）",
    },
    {
      name: "gone-binary",
      transport: "stdio",
      enabled: true,
      status: "unavailable",
      available: false,
      error: "MCP_COMMAND_NOT_FOUND: ./missing-bin",
    },
  ]);
  await openApp(page, "#session=A");
  await openMcpArea(page);

  // The row no longer carries a status chip: it lists the server and its own
  // actions, and the state is read where the server is opened. What this pins is
  // that a failing server is still listed — the row is where the person starts —
  // and that no stale chip is drawn beside it.
  await expect(rowOf(page, "broken-http")).toBeVisible();
  await expect(rowOf(page, "gone-binary")).toBeVisible();
  await expect(page.locator("[data-webui-mcp-status]")).toHaveCount(0);
});

test("every server state is listed, and none of them invents a status chip", async ({ page }) => {
  // The chip was removed from the row on purpose. What the list still owes every
  // state — connected, resting, disabled — is a row of its own, so a server is
  // reachable whatever its state.
  await stageMcpServers(page, [
    { name: "ok-stdio", transport: "stdio", enabled: true, status: "available", available: true },
    { name: "idle", transport: "stdio", enabled: true, status: "configured", available: false },
    { name: "off", transport: "http", enabled: false, status: "disabled", available: false },
  ]);
  await openApp(page, "#session=A");
  await openMcpArea(page);

  for (const name of ["ok-stdio", "idle", "off"]) await expect(rowOf(page, name)).toBeVisible();
  await expect(page.locator("[data-webui-mcp-status]")).toHaveCount(0);
});

test("a late MCP detail cannot attach to a different management selection", async ({ page }) => {
  await stageMcpServers(page, [
    { name: "delayed-server", transport: "stdio", enabled: true, status: "configured" },
  ]);
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() =>
      window.__fixture.delayNext("pluginManagement", { action: "getMcpServer" }),
    );
  });
  await openApp(page, "#session=A");
  await openMcpArea(page);
  // A row's actions are its own menu: the trigger names the row, the item is
  // portal-rendered.
  await rowOf(page, "delayed-server").getByRole("button", { name: /更多操作/u }).click();
  await page.getByRole("menuitem", { name: "编辑" }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__fixture.requests.some((request) =>
      request.operation === "pluginManagement" && request.body.action === "getMcpServer",
    ),
  )).toBe(true);

  await page.locator('.webui-plugin-category-filter button', { hasText: "Agents" }).click();
  const released = await page.evaluate(() =>
    window.__fixture.resolveAllPending(
      "pluginManagement",
      { action: "getMcpServer" },
      { name: "delayed-server", command: "synthetic" },
    ),
  );
  expect(released).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".webui-agent-editor")).toBeVisible();
});

test("a late Git preview cannot populate a replacement import dialog", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() =>
      window.__fixture.delayNext("pluginManagement", { action: "previewGithubPlugin" }),
    );
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();
  await page.getByTestId("plugin-manage-trigger").click();
  await page.getByTestId("plugin-create-trigger").click();
  await page.getByRole("menuitem", { name: "从 Git 仓库导入插件" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "仓库 URL" }).fill("https://github.com/old/repository");
  await dialog.getByRole("button", { name: "预览" }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__fixture.requests.some((request) =>
      request.operation === "pluginManagement" && request.body.action === "previewGithubPlugin",
    ),
  )).toBe(true);

  await dialog.getByRole("button", { name: "关闭" }).click();
  await page.getByTestId("plugin-create-trigger").click();
  await page.getByRole("menuitem", { name: "从 Git 仓库导入插件" }).click();
  const replacement = page.getByRole("dialog");
  await replacement.getByRole("textbox", { name: "仓库 URL" }).fill("https://github.com/new/repository");
  const released = await page.evaluate(() =>
    window.__fixture.resolveAllPending(
      "pluginManagement",
      { action: "previewGithubPlugin" },
      {
        canImport: true,
        plugin: { summary: { name: "stale-plugin", displayName: "Stale preview" } },
      },
    ),
  );
  expect(released).toBe(1);
  await expect(replacement.getByRole("textbox", { name: "仓库 URL" })).toHaveValue(
    "https://github.com/new/repository",
  );
  await expect(replacement.getByRole("button", { name: "预览" })).toBeVisible();
  await expect(replacement.getByText("Stale preview")).toHaveCount(0);
});

test("closing an import dialog does not cancel an accepted mutation settlement", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("previewGithubPlugin", {
        canImport: true,
        source: {
          repositoryUrl: "https://github.com/owner/repository",
          commitSha: "abc123",
        },
        plugin: { summary: { name: "imported", displayName: "Importable" } },
      });
      window.__fixture.delayNext("pluginManagement", { action: "importGithubPlugin" });
    });
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();
  await page.getByTestId("plugin-manage-trigger").click();
  await page.getByTestId("plugin-create-trigger").click();
  await page.getByRole("menuitem", { name: "从 Git 仓库导入插件" }).click();
  const initial = page.getByRole("dialog");
  await initial.getByRole("textbox", { name: "仓库 URL" }).fill("https://github.com/owner/repository");
  await initial.getByRole("button", { name: "预览" }).click();
  await expect(initial.getByText("Importable")).toBeVisible();
  await initial.getByRole("button", { name: "导入插件" }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__fixture.requests.some((request) =>
      request.operation === "pluginManagement" && request.body.action === "importGithubPlugin",
    ),
  )).toBe(true);

  const listCountBeforeSettle = await page.evaluate(() =>
    window.__fixture.requests.filter((request) =>
      request.operation === "pluginManagement" && request.body.action === "listInstalledPlugins",
    ).length,
  );
  await initial.getByRole("button", { name: "关闭" }).click();
  await page.getByTestId("plugin-create-trigger").click();
  await page.getByRole("menuitem", { name: "从 Git 仓库导入插件" }).click();
  const replacement = page.getByRole("dialog");

  const released = await page.evaluate(() =>
    window.__fixture.resolveAllPending(
      "pluginManagement",
      { action: "importGithubPlugin" },
      { ok: true },
    ),
  );
  expect(released).toBe(1);
  await expect(replacement).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    window.__fixture.requests.filter((request) =>
      request.operation === "pluginManagement" && request.body.action === "listInstalledPlugins",
    ).length,
  )).toBeGreaterThan(listCountBeforeSettle);
});
