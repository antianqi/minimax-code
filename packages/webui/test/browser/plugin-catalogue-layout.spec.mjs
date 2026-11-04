import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";

import { openApp, screenshotOptions, test } from "./harness.mjs";

test("marketplace and management keep vertical categories pinned on the left", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listInstalledPlugins", {
        plugins: Array.from({ length: 30 }, (_, index) => ({
          name: `scroll-fixture-${index}`,
          displayName: `Scroll fixture ${index}`,
          description: "Synthetic row for plugin page scroll coverage",
          enabled: true,
        })),
      });
    });
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();

  const layout = page.locator(".webui-plugin-page-layout");
  const marketSearch = layout.locator(".webui-plugin-page-search");
  const marketContent = layout.locator(".webui-plugin-page-content");
  await expect(layout).toBeVisible();
  await expect(page.getByRole("navigation", { name: "市场分类" })).toBeVisible();
  await expect(marketSearch.getByLabel("搜索插件")).toBeVisible();
  // The catalogue is sectioned inside a single content frame now: there is no
  // categories column beside it, and the market view does not carry the shared
  // page's search wrapper at every width. What the page still promises is what
  // this measures: the filter row is a vertical stack, the content frame holds
  // the sections, and the whole page fits the viewport's width.
  const marketGeometry = await page.locator(".webui-plugin-category-filter").first().evaluate((filter) => ({
    rowDirection: getComputedStyle(filter).flexDirection,
    firstButtonTextSize: Number.parseFloat(getComputedStyle(filter.querySelector(".webui-mavis-button")).fontSize),
    categoryButtons: filter.querySelectorAll(".webui-mavis-button").length,
  }));
  expect(marketGeometry.rowDirection).toBe("column");
  expect(marketGeometry.firstButtonTextSize).toBe(14);
  // The filter row offers the categories the hub lists — the fixture's list is
  // one entry, so this pins the row rather than a count.
  expect(marketGeometry.categoryButtons).toBeGreaterThanOrEqual(1);
  const captureDir = process.env.WEBUI_PLUGIN_LAYOUT_SCREENSHOT_DIR;
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    await page.screenshot({ path: join(captureDir, "plugin-marketplace.png"), fullPage: true });
  }

  await page.getByTestId("plugin-manage-trigger").click();
  await expect(page.getByRole("navigation", { name: "插件管理分类" })).toBeVisible();
  await expect(layout.locator(".webui-plugin-page-search").getByLabel("搜索插件")).toBeVisible();
  const managementGeometry = await layout.evaluate((element) => {
    const search = element.querySelector(".webui-plugin-page-search").getBoundingClientRect();
    const content = element.querySelector(".webui-plugin-page-content").getBoundingClientRect();
    return {
      rowDirection: getComputedStyle(element.querySelector(".webui-plugin-category-filter")).flexDirection,
      searchAlignedWithContent: Math.abs(search.left - content.left) < 2,
      searchWidth: search.width,
      searchAboveContent: search.bottom <= content.top,
    };
  });
  expect(managementGeometry).toEqual({
    rowDirection: "column",
    searchAlignedWithContent: true,
    searchWidth: expect.any(Number),
    searchAboveContent: true,
  });
  expect(managementGeometry.searchWidth).toBeLessThanOrEqual(768);
  const scrollRegion = layout.locator(".webui-plugin-page-scroll");
  const pinnedGeometry = await layout.evaluate((element) => ({
    searchTop: element.querySelector(".webui-plugin-page-controls").getBoundingClientRect().top,
    scrollHeight: element.querySelector(".webui-plugin-page-scroll").scrollHeight,
    clientHeight: element.querySelector(".webui-plugin-page-scroll").clientHeight,
    layoutHeight: element.getBoundingClientRect().height,
    mainHeight: element.querySelector(".webui-plugin-page-main").getBoundingClientRect().height,
  }));
  expect(pinnedGeometry.mainHeight).toBe(pinnedGeometry.layoutHeight);
  expect(pinnedGeometry.scrollHeight).toBeGreaterThan(pinnedGeometry.clientHeight);
  await scrollRegion.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  // The controls stay where they were while the list scrolls under them.
  await expect.poll(() => layout.evaluate((element) => ({
    searchTop: element.querySelector(".webui-plugin-page-controls").getBoundingClientRect().top,
  }))).toEqual({ searchTop: pinnedGeometry.searchTop });
  const managementRows = await layout.locator(".webui-plugin-list").first().boundingBox();
  const managementSearch = await layout.locator(".webui-plugin-page-search").boundingBox();
  expect(Math.abs(managementRows.x - managementSearch.x)).toBeLessThan(2);
  if (captureDir) {
    await page.screenshot({ path: join(captureDir, "plugin-management.png"), fullPage: true });
  }

  await page.setViewportSize({ width: 480, height: 900 });
  const narrowGeometry = await layout.evaluate((element) => {
    const categories = element.querySelector(".webui-plugin-category-filter");
    return {
      direction: getComputedStyle(categories).flexDirection,
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
    };
  });
  expect(narrowGeometry).toEqual({ direction: "column", noHorizontalOverflow: true });
  if (captureDir) {
    await page.screenshot({ path: join(captureDir, "plugin-management-narrow.png"), fullPage: true });
  }
});

test("the skills marketplace renders rows from the skill hub listing", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listMarketplacePlugins", { plugins: [], pluginTotal: 0 });
      window.__fixture.setPluginManagementResult("listInstalledPlugins", { plugins: [] });
      window.__fixture.setPluginManagementResult("listSkillHub", {
        skills: [{ name: "release-notes", displayName: "Release notes", description: "Prepare a release summary", url: "https://example.invalid/release-notes" }],
      });
    });
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();
  const surface = page.getByTestId("plugin-management");
  await page.evaluate(() => window.__fixture.delayNext("pluginManagement", { action: "listSkillHub" }));
  await surface.getByRole("button", { name: "技能", exact: true }).click();
  const skeleton = page.getByTestId("plugin-market-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(surface.locator(".webui-plugin-page-search .webui-skeleton")).toHaveCount(0);
  await expect(surface.locator(".webui-plugin-page-search input")).toBeVisible();
  await expect(surface.locator(".webui-plugin-page-categories")).toHaveCount(0);
  await expect(surface.locator(".webui-plugin-header .webui-skeleton")).toHaveCount(0);
  await expect(skeleton.locator(".webui-feedback-skeleton-body > .webui-skeleton")).toHaveCount(12);
  const skillSkeletonBody = await skeleton.locator(".webui-feedback-skeleton-body").boundingBox();
  const skillSearchWhileLoading = await surface.locator(".webui-plugin-page-search").boundingBox();
  // The placeholder is laid out in the column it stands in for: the skills list is
  // centred at the search field's width, so a skeleton spanning the page's wider
  // column made the list jump sideways the moment the rows arrived.
  expect(skillSkeletonBody.width).toBeLessThanOrEqual(skillSearchWhileLoading.width + 1);
  expect(Math.abs(skillSkeletonBody.x - skillSearchWhileLoading.x)).toBeLessThanOrEqual(16);
  await page.evaluate(() => window.__fixture.resolveAllPending(
    "pluginManagement",
    { action: "listSkillHub" },
    { skills: [{ name: "release-notes", displayName: "Release notes", description: "Prepare a release summary", url: "https://example.invalid/release-notes" }] },
  ));
  await expect(surface.locator(".webui-plugin-grid .webui-plugin-row")).toHaveCount(1);
  await expect(surface.getByText("Release notes")).toBeVisible();
  const skillSearch = await surface.locator(".webui-plugin-page-search").boundingBox();
  const skillRow = await surface.locator(".webui-plugin-grid .webui-plugin-row").first().boundingBox();
  expect(skillSearch.width).toBeLessThanOrEqual(768);
  expect(Math.abs(skillRow.x - skillSearch.x)).toBeLessThanOrEqual(16);
  const captureDir = process.env.WEBUI_SKILL_CATALOGUE_SCREENSHOT_DIR;
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    await page.screenshot({ path: join(captureDir, "skill-marketplace.png"), fullPage: true });
  }
});

test("plugin loading uses the shared single-layer skeleton", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.delayNext("pluginManagement", { action: "listMarketplacePlugins" });
      window.__fixture.setPluginManagementResult("listInstalledPlugins", { plugins: [] });
    });
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();
  await page.setViewportSize({ width: 315, height: 470 });
  const skeleton = page.getByTestId("plugin-market-skeleton");
  await expect(skeleton).toBeVisible();
  const searchSkeletons = page.locator(".webui-plugin-page-search .webui-skeleton");
  await expect(searchSkeletons).toHaveCount(0);
  await expect(page.locator(".webui-plugin-page-search input")).toBeVisible();
  await expect(page.locator(".webui-plugin-header .webui-skeleton")).toHaveCount(0);
  await expect(page.locator(".webui-plugin-page-categories .webui-skeleton")).toHaveCount(0);
  const searchBox = await page.locator(".webui-plugin-page-search .webui-search-field").boundingBox();
  expect(searchBox.width).toBeGreaterThan(0);
  expect(searchBox.height).toBeGreaterThan(0);
  await expect(skeleton.locator(".webui-feedback-skeleton-body > .webui-skeleton")).toHaveCount(12);
  await expect(skeleton.locator(".webui-plugin-market-skeleton-row")).toHaveCount(0);
  const shapes = await skeleton.locator(".webui-skeleton").evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      backgroundImage: style.backgroundImage,
      animationName: style.animationName,
      nestedSkeletons: element.querySelectorAll(".webui-skeleton").length,
    };
  }));
  expect(shapes).toHaveLength(12);
  expect(shapes.every((shape) => shape.boxShadow === "none" && shape.backgroundImage === "none" && shape.nestedSkeletons === 0), JSON.stringify(shapes)).toBe(true);
  expect(shapes.every((shape) => shape.animationName === "webui-skeleton-pulse")).toBe(true);
  const rows = await skeleton.locator(".webui-feedback-skeleton-body > .webui-skeleton").evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, background: style.backgroundColor, opacity: style.opacity };
    }),
  );
  expect(rows.every((row, index) => row.width > 0 && row.width <= 266 && row.height === 28 && row.background !== "rgba(0, 0, 0, 0)" && (index === 0 || row.top > rows[index - 1].top)), JSON.stringify(rows)).toBe(true);
  expect(new Set(rows.map((row) => row.width)).size).toBeGreaterThan(4);
  if (process.env.WEBUI_PLUGIN_LAYOUT_SCREENSHOT_DIR) {
    mkdirSync(process.env.WEBUI_PLUGIN_LAYOUT_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: join(process.env.WEBUI_PLUGIN_LAYOUT_SCREENSHOT_DIR, "plugin-loading-skeleton.png"),
      fullPage: true,
    });
  }
  const released = await page.evaluate(() => window.__fixture.resolveAllPending(
    "pluginManagement",
    { action: "listMarketplacePlugins" },
    { plugins: [], pluginTotal: 0 },
  ));
  expect(released).toBe(1);
  await expect(skeleton).toHaveCount(0);
});

test("plugin management loading uses the shared skeleton group", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listMarketplacePlugins", { plugins: [], pluginTotal: 0 });
      window.__fixture.setPluginManagementResult("listInstalledPlugins", { plugins: [] });
    });
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();
  await page.evaluate(() => window.__fixture.delayNext("pluginManagement", { action: "listInstalledPlugins" }));
  await page.getByTestId("plugin-manage-trigger").click();

  const skeleton = page.getByTestId("plugin-management-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(skeleton.locator(".webui-feedback-skeleton-body > .webui-skeleton")).toHaveCount(12);
  await expect(skeleton.locator(".webui-plugin-management-skeleton-row")).toHaveCount(0);
  const released = await page.evaluate(() => window.__fixture.resolveAllPending(
    "pluginManagement",
    { action: "listInstalledPlugins" },
    { plugins: [] },
  ));
  expect(released).toBe(1);
  await expect(skeleton).toHaveCount(0);
});

test("marketplace categories scroll to available sections without filtering the listing", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listMarketplacePlugins", {
        pluginTotal: 2,
        tagDefinitions: [{ key: "miniapp", displayName: "Mini App" }],
        plugins: [
          { name: "board", displayName: "Board", category: 1, tags: [{ key: "miniapp", displayName: "Mini App" }] },
          { name: "other", displayName: "Other", category: 2 },
        ],
      });
      window.__fixture.setPluginManagementResult("listInstalledPlugins", { plugins: [] });
    });
  });
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();
  const group = page.getByRole("region", { name: "Mini App" });
  await expect(group).toContainText("Board");
  await expect(group).not.toContainText("Other");
  const requestCount = await page.evaluate(() => window.__fixture.requests.filter((entry) =>
    entry.operation === "pluginManagement" && entry.body.action === "listMarketplacePlugins").length);
  await page.getByRole("navigation", { name: "市场分类" }).getByRole("button", { name: "Mini App" }).click();
  await expect(group).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "市场分类" }).getByRole("button", { name: "Mini App" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-plugin-category-section="category:2"]')).toContainText("Other");
  const requestCountAfter = await page.evaluate(() => window.__fixture.requests.filter((entry) =>
    entry.operation === "pluginManagement" && entry.body.action === "listMarketplacePlugins").length);
  expect(requestCountAfter).toBe(requestCount);
  await page.locator(".webui-plugin-grid").getByRole("button", { name: "安装" }).first().click();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((entry) =>
    entry.operation === "pluginManagement" && entry.body.action === "installPlugin" && entry.body.input?.pluginName === "board"))).toBe(true);
});

async function openManagement(page) {
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();
  await page.getByTestId("plugin-manage-trigger").click();
  await page.getByTestId("plugin-create-trigger").click();
}

test("Agents management shows the first agent and a half-size detail avatar by default", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listAgents", {
        agents: [
          { name: "first-agent", displayName: "First Agent", description: "First description", systemPrompt: "First prompt", model: "stub-model" },
          { name: "second-agent", displayName: "Second Agent", description: "Second description", systemPrompt: "Second prompt" },
        ],
      });
    });
  });
  await openManagement(page);
  await page.locator(".webui-plugin-category-filter button", { hasText: "Agents" }).click();

  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) =>
    request.operation === "pluginManagement" && request.body.action === "listAgents" &&
    request.body.input?.include?.split(",").includes("model"),
  ))).toBe(true);
  await expect(page.getByTestId("webui-agent-detail-name")).toHaveText("first-agent");
  await expect(page.getByTestId("webui-agent-detail-description")).toHaveText("First description");
  await expect(page.getByTestId("webui-agent-detail-model")).toHaveText("stub-model");
  const avatar = page.locator(".webui-agent-detail .webui-agent-avatar");
  await expect(avatar).toHaveCSS("width", "32px");
  await expect(avatar).toHaveCSS("height", "32px");
});

test("Agent add and edit forms show the model picker above the system prompt", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listAgents", {
        agents: [{ name: "first-agent", displayName: "First Agent", description: "First description", systemPrompt: "First prompt", model: "stub-model" }],
      });
      window.__fixture.setModels([
        { providerId: "fixture", providerName: "Fixture Provider", modelId: "stub-model", displayName: "Stub Model" },
      ]);
    });
  });
  await openManagement(page);
  await page.locator(".webui-plugin-category-filter button", { hasText: "Agents" }).click();

  const dialog = page.locator('[data-webui-dialog-shell="true"][data-overlay-layer="plugin-item-dialog"]');
  await page.getByRole("button", { name: "First Agent" }).click();
  await expect(dialog.getByLabel("模型")).toContainText("Stub Model");
  await dialog.getByLabel("模型").click();
  await expect(page.locator('[data-webui-model-list-row="fixture/stub-model/"]')).toBeVisible();
  await page.keyboard.press("Escape");
  const editOrder = await dialog.locator(".webui-agent-form").evaluate((form) =>
    [...form.querySelectorAll("label")].map((label) => label.textContent.trim()),
  );
  expect(editOrder.indexOf("模型")).toBeGreaterThanOrEqual(0);
  expect(editOrder.indexOf("模型")).toBeLessThan(editOrder.indexOf("系统提示词"));
  await dialog.getByRole("button", { name: "取消" }).click();

  await page.getByTestId("plugin-create-trigger").click();
  const createMenu = page.getByRole("menu", { name: "创建" });
  await createMenu.getByRole("menuitem", { name: "创建 Agent" }).click();
  await expect(dialog.getByLabel("模型")).toBeVisible();
  const addOrder = await dialog.locator(".webui-agent-form").evaluate((form) =>
    [...form.querySelectorAll("label")].map((label) => label.textContent.trim()),
  );
  expect(addOrder.indexOf("模型")).toBeGreaterThanOrEqual(0);
  expect(addOrder.indexOf("模型")).toBeLessThan(addOrder.indexOf("系统提示词"));
});

test("Agents management list and detail scroll independently", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      const longText = Array.from({ length: 200 }, (_, index) => `Synthetic detail paragraph ${index + 1}`).join(". ");
      window.__fixture.setPluginManagementResult("listAgents", {
        agents: Array.from({ length: 24 }, (_, index) => ({
          name: `agent-${String(index + 1).padStart(2, "0")}`,
          displayName: `Agent ${String(index + 1).padStart(2, "0")}`,
          description: index === 0 ? longText : `Synthetic description ${index + 1}`,
          systemPrompt: index === 0 ? longText : `Synthetic prompt ${index + 1}`,
        })),
      });
    });
  });
  await openManagement(page);
  await page.locator(".webui-plugin-category-filter button", { hasText: "Agents" }).click();

  const list = page.locator(".webui-agent-list");
  const detail = page.locator(".webui-agent-detail");
  const initial = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: style.overflowY,
      };
    };
    return {
      list: read(".webui-agent-list"),
      detail: read(".webui-agent-detail"),
    };
  });
  expect(initial.list.scrollHeight).toBeGreaterThan(initial.list.clientHeight);
  expect(initial.detail.scrollHeight).toBeGreaterThan(initial.detail.clientHeight);
  expect(["auto", "scroll"]).toContain(initial.list.overflowY);
  expect(["auto", "scroll"]).toContain(initial.detail.overflowY);

  await list.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await detail.evaluate((element) => element.scrollTop)).toBe(0);
  const listScrollTop = await list.evaluate((element) => element.scrollTop);
  await detail.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => detail.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(listScrollTop);
  expect(await page.locator(".webui-plugin-page-scroll").evaluate((element) => element.scrollTop)).toBe(0);
});

async function expectCenteredDialog(dialog, page, fieldsSelector, expectedFieldsDisplay = "grid") {
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await dialog.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  const geometry = await dialog.evaluate((node, fieldsSelector) => {
    const backdrop = node.parentElement;
    const backdropBox = backdrop.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const fields = fieldsSelector ? node.querySelector(fieldsSelector) : null;
    const fieldsStyle = fields ? getComputedStyle(fields) : null;
    return {
      backdropFixed: getComputedStyle(backdrop).position === "fixed",
      backdropCoversViewport: backdropBox.left <= 0 && backdropBox.top <= 0 &&
        backdropBox.right >= innerWidth && backdropBox.bottom >= innerHeight,
      centered: Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 3 &&
        Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 3,
      insideViewport: rect.left >= 0 && rect.top >= 0 &&
        rect.right <= innerWidth && rect.bottom <= innerHeight,
      fieldsDisplay: fieldsStyle?.display,
    };
  }, fieldsSelector);
  expect(geometry, JSON.stringify(geometry)).toMatchObject({
    backdropFixed: true,
    backdropCoversViewport: true,
    centered: true,
    insideViewport: true,
    ...(fieldsSelector ? { fieldsDisplay: expectedFieldsDisplay } : {}),
  });
  await expect(page.locator('[data-webui-dialog-scrim="true"]')).toHaveScreenshot(screenshotOptions);
}

async function expectMobileDialog(dialog, page, fieldsSelector) {
  await page.setViewportSize({ width: 390, height: 844 });
  // The dialog's form follows the dialog's own width, not the width of the
  // window (ADR 0025). The single-column assertion below is what proves the
  // narrow tier is in force; there is no viewport breakpoint left to match.
  await expect.poll(() => dialog.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThan(390);
  const layout = await dialog.evaluate((node, fieldsSelector) => {
    const rect = node.getBoundingClientRect();
    const fields = node.querySelector(fieldsSelector);
    const style = getComputedStyle(fields);
    return {
      withinViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
      noHorizontalOverflow: node.scrollWidth <= node.clientWidth,
      singleColumn: style.gridTemplateColumns.split(" ").filter(Boolean).length === 1,
      controlsHaveReadableWidth: [...fields.querySelectorAll("input:not([type=checkbox]), select, textarea")]
        .every((control) => control.getBoundingClientRect().width >= 280),
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, fieldsSelector);
  expect(layout, JSON.stringify(layout)).toMatchObject({
    withinViewport: true,
    noHorizontalOverflow: true,
    singleColumn: true,
    controlsHaveReadableWidth: true,
  });
}

test("plugin marketplace keeps its card grid and expand/collapse count", async ({ page }, testInfo) => {
  await page.route("**/workspace-file?*", (route) => route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><rect width=\"40\" height=\"40\" fill=\"red\"/></svg>",
  }));
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listMarketplacePlugins", {
        pluginTotal: 10,
        plugins: Array.from({ length: 10 }, (_, index) => ({
          name: `market-plugin-${index + 1}`,
          displayName: `Market plugin ${index + 1}`,
          description: "Marketplace card",
          ...(index === 0 ? { icon_url: "/mavis/api/file/preview?path=%2Fplugins%2Fmarket-plugin-1%2Ficon.svg" } : {}),
          ...(index === 0 ? { installed: true } : {}),
        })),
      });
      window.__fixture.setPluginManagementResult("listInstalledPlugins", {
        plugins: [{
          name: "market-plugin-1",
          displayName: "Market plugin 1",
          description: "Installed plugin",
          enabled: true,
        }],
      });
    });
  });

  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();

  const cards = page.locator('[data-plugin-category-section="featured"] .webui-plugin-grid .webui-plugin-row');
  await expect(cards).toHaveCount(10);
  await expect(cards.nth(9)).toBeVisible();
  const icon = cards.first().locator("img");
  await expect(icon).toHaveAttribute("src", /\/workspace-file\?token=synthetic-token&dir=%2Fplugins%2Fmarket-plugin-1&path=icon\.svg/u);
  await expect.poll(() => icon.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole("heading", { name: "精选" }).last()).toBeVisible();
  const installedActionInset = await cards.first().getByRole("button", { name: "已安装" }).evaluate((button) => {
    const row = button.closest(".webui-plugin-row");
    return row.getBoundingClientRect().right - button.getBoundingClientRect().right;
  });
  expect(Math.abs(installedActionInset - 12)).toBeLessThan(2);

  const captureDir = process.env.WEBUI_DECOMPOSITION_SCREENSHOT_DIR;
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    await page.screenshot({
      path: join(captureDir, "d06-plugin-market-expanded.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "收起插件" }).click();
  const expandedList = page.getByTestId("webui-plugin-expanded-list");
  await expect(expandedList).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => expandedList.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);

  await expect(page.getByRole("button", { name: "查看全部 10 个" })).toBeVisible();
  const showAllGeometry = await page.getByRole("button", { name: "查看全部 10 个" }).evaluate((button) => {
    const container = button.closest(".webui-plugin-page-content");
    const buttonRect = button.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      offset: Math.abs(buttonRect.left + buttonRect.width / 2 - (containerRect.left + containerRect.width / 2)),
      button: { left: buttonRect.left, right: buttonRect.right, width: buttonRect.width, display: getComputedStyle(button).display, marginLeft: getComputedStyle(button).marginLeft, marginRight: getComputedStyle(button).marginRight },
      container: { left: containerRect.left, right: containerRect.right, width: containerRect.width },
    };
  });
  expect(showAllGeometry.offset, JSON.stringify(showAllGeometry)).toBeLessThan(2);
  if (captureDir) {
    await page.screenshot({
      path: join(captureDir, "d06-plugin-market-collapsed.png"),
      fullPage: true,
    });
  }

  await page.getByRole("button", { name: "查看全部 10 个" }).click();
  await expect(expandedList).toHaveAttribute("data-webui-motion-state", "expand");
  await expect(cards.nth(9)).toBeVisible();
  const columns = await Promise.all([0, 1].map(async (column) => Promise.all([
    cards.nth(column).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    }),
    cards.nth(column + 8).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    }),
  ])));
  for (const [preview, expanded] of columns) {
    expect(Math.abs(preview.left - expanded.left), "expanded cards keep the preview column alignment").toBeLessThan(8);
    expect(Math.abs(preview.width - expanded.width), "expanded cards keep the preview column width").toBeLessThan(8);
  }

  await page.getByTestId("plugin-manage-trigger").click();
  const installedIcon = page.locator(".webui-plugin-management.is-managing .webui-plugin-list img").first();
  await expect(installedIcon).toHaveAttribute("src", /\/workspace-file\?token=synthetic-token&dir=%2Fplugins%2Fmarket-plugin-1&path=icon\.svg/u);
  await expect.poll(() => installedIcon.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
});

test("Skill add form is centered, usable and submits through plugin management", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listManageableSkills", { skills: [] });
      window.__fixture.setPluginManagementResult("createSkill", { success: true });
    });
  });
  await openManagement(page);
  await page.getByRole("menuitem", { name: "录入技能" }).click();
  const dialog = page.getByRole("dialog", { name: "技能" });
  await expectCenteredDialog(dialog, page, ".webui-skill-form");
  await expectMobileDialog(dialog, page, ".webui-skill-form");
  await dialog.getByLabel("名称").fill("local-checklist");
  await dialog.getByLabel("描述").fill("Synthetic workflow skill");
  await dialog.getByLabel("内容").fill("Check the local workflow.");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) =>
    request.operation === "pluginManagement" && request.body.action === "createSkill",
  ))).toBe(true);
  const request = await page.evaluate(() => window.__fixture.requests.find((entry) =>
    entry.operation === "pluginManagement" && entry.body.action === "createSkill",
  ));
  expect(request.body.input).toMatchObject({
    name: "local-checklist",
    description: "Synthetic workflow skill",
    content: "Check the local workflow.",
  });
  await expect(dialog).toHaveCount(0);
});

test("the plugin item dialog completes its shared exit before unmounting", async ({ page }) => {
  await openManagement(page);
  await page.getByRole("menuitem", { name: "录入技能" }).click();
  const dialog = page.getByRole("dialog", { name: "技能" });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    window.__pluginItemDialogExitEnded = false;
    document.addEventListener("animationend", (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.classList.contains("webui-dialog-mask") &&
        event.animationName === "webui-motion-surface-exit"
      ) {
        window.__pluginItemDialogExitEnded = true;
      }
    }, { capture: true });
  });
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect.poll(() => page.evaluate(() => window.__pluginItemDialogExitEnded)).toBe(true);
  await expect(dialog).toHaveCount(0);
});

test("the Git import dialog completes its shared exit before unmounting", async ({ page }) => {
  await openManagement(page);
  await page.getByRole("menuitem", { name: "从 Git 仓库导入插件" }).click();
  const dialog = page.getByRole("dialog", { name: "从 Git 仓库导入插件" });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    window.__pluginImportDialogExitEnded = false;
    document.addEventListener("animationend", (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.classList.contains("webui-dialog-mask") &&
        event.animationName === "webui-motion-surface-exit"
      ) {
        window.__pluginImportDialogExitEnded = true;
      }
    }, { capture: true });
  });
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect.poll(() => page.evaluate(() => window.__pluginImportDialogExitEnded)).toBe(true);
  await expect(dialog).toHaveCount(0);
});

test("closing an Agent form keeps Agent content throughout the exit animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listAgents", { agents: [] });
    });
  });
  await openManagement(page);
  const createMenu = page.getByRole("menu", { name: "创建" });
  const createAgent = createMenu.getByRole("menuitem", { name: "创建 Agent" });
  await expect(createAgent).toBeVisible();
  await createAgent.click();

  const dialog = page.locator('[data-webui-dialog-shell="true"][data-overlay-layer="plugin-item-dialog"]');
  await expect(dialog.locator("h2")).toHaveText("添加Agent");
  await page.locator('[data-webui-dialog-scrim="true"]').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveAttribute("aria-hidden", "true");
  await expect(dialog.locator("h2")).toHaveText("添加Agent");
  await expect(dialog.locator(".webui-agent-form")).toHaveCount(1);
  await expect(dialog.locator(".webui-mcp-form")).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
});

test("Agent add form is centered, fields are aligned and backdrop dismissal works", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listAgents", { agents: [] });
      window.__fixture.setPluginManagementResult("createAgent", { success: true });
      // The 模型 field is the catalogue's own list, so the form needs a
      // catalogue to choose from.
      window.__fixture.setModels([
        { providerId: "fixture", providerName: "Fixture Provider", modelId: "stub-model", displayName: "Stub Model" },
        { providerId: "fixture", providerName: "Fixture Provider", modelId: "other-model", displayName: "Other Model" },
      ]);
    });
  });
  await openManagement(page);
  // The create menu mounts in an effect after its trigger is clicked, so the
  // entry can still be missing a moment later — and "创建 Agent" is also the
  // name of a button of its own on the agent list, which this same page shows
  // once an agent form has been opened. The query is scoped to the menu and
  // waits for the entry, so the click lands on the menu entry and never on
  // whatever else happens to carry the same name.
  const createMenu = page.getByRole("menu", { name: "创建" });
  const createAgent = createMenu.getByRole("menuitem", { name: "创建 Agent" });
  await expect(createAgent).toBeVisible();
  await createAgent.click();
  const dialog = page.getByRole("dialog", { name: "Agent" });
  await expectCenteredDialog(dialog, page, ".webui-agent-form");
  await expectMobileDialog(dialog, page, ".webui-agent-form");
  const alignment = await dialog.evaluate((node) => {
    const labels = [...node.querySelectorAll(".webui-agent-form label")];
    // The field contract owns the label, so a label no longer wraps its
    // control: the control is the field's own child, and the label is its
    // sibling. The assertion is about the control's box, so it reads the
    // controls directly.
    const controls = [...node.querySelectorAll(".webui-agent-form input, .webui-agent-form textarea")];
    const labelBoxes = labels.map((label) => label.getBoundingClientRect());
    const prompt = node.querySelector("textarea").getBoundingClientRect();
    return {
      labelCount: labels.length,
      promptHasWidth: prompt.width >= 280,
      promptWidth: prompt.width,
      formColumns: getComputedStyle(node.querySelector(".webui-agent-form")).gridTemplateColumns,
      dialogWidth: node.getBoundingClientRect().width,
      // The modal field contract's control height is 36px
      // (docs/design/design-language.md), so that is the floor a dialog field
      // has to clear; 40 was a number no contract owned.
      labelInputsHaveUsableHeight: controls.every(
        (control) => control.getBoundingClientRect().height >= 36,
      ),
      noHorizontalOverflow: node.scrollWidth <= node.clientWidth,
      labelBoxesInDialog: labelBoxes.every((box) => box.left >= node.getBoundingClientRect().left && box.right <= node.getBoundingClientRect().right),
    };
  });
  expect(alignment, JSON.stringify(alignment)).toMatchObject({ labelCount: 4, promptHasWidth: true, labelInputsHaveUsableHeight: true, noHorizontalOverflow: true, labelBoxesInDialog: true });
  await page.locator('[data-webui-dialog-scrim="true"]').click({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);

  await page.getByTestId("plugin-create-trigger").click();
  await expect(createAgent).toBeVisible();
  await createAgent.click();
  const reopened = page.getByRole("dialog", { name: "Agent" });
  await reopened.getByLabel("名称").fill("local-agent");
  await reopened.getByLabel("描述").fill("A synthetic local agent");
  await reopened.getByLabel("系统提示词").fill("Use only the local test workspace.");
  // The 模型 field is the catalogue's own list: open it and pick the row.
  await reopened.getByLabel("模型").click();
  await page.locator('[data-webui-model-list-row="fixture/stub-model/"]').click();
  await expect(reopened.getByLabel("模型")).toContainText("Stub Model");
  await reopened.getByRole("button", { name: "保存" }).click();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) =>
    request.operation === "pluginManagement" && request.body.action === "createAgent",
  ))).toBe(true);
  const request = await page.evaluate(() => window.__fixture.requests.find((entry) =>
    entry.operation === "pluginManagement" && entry.body.action === "createAgent",
  ));
  expect(request.body.input).toMatchObject({
    name: "local-agent",
    description: "A synthetic local agent",
    systemPrompt: "Use only the local test workspace.",
    initialDefinition: { model: "stub-model" },
  });
  await expect(reopened).toHaveCount(0);
});

test("MCP add form validates inputs, switches transport and sends advanced HTTP config", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listMcpServers", { servers: [] });
      window.__fixture.setPluginManagementResult("createMcpServer", { success: true });
    });
  });
  await openManagement(page);
  await page.getByRole("menuitem", { name: "添加 MCP server" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP Server" });
  await expectCenteredDialog(dialog, page, ".webui-mcp-form-fields");
  await expect(dialog.getByRole("switch", { name: "启用 MCP server" })).toBeChecked();
  await expectMobileDialog(dialog, page, ".webui-mcp-form-fields");

  await dialog.getByLabel("名称").fill("local-docs");
  // The transport is the shared select menu: a trigger plus a portal-rendered
  // option list, not a native <select>.
  await dialog.getByRole("combobox", { name: "传输方式" }).click();
  await page.getByRole("option", { name: "http", exact: true }).click();
  await expect(dialog.getByLabel("地址")).toBeVisible();
  await expect(dialog.getByLabel("命令")).toHaveCount(0);
  await dialog.getByLabel("地址").fill("http://127.0.0.1:43121/mcp");
  const advancedToggle = dialog.getByRole("button", { name: "高级" });
  const advancedFields = dialog.locator("#webui-mcp-advanced-fields");
  await expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
  await expect(advancedFields).toHaveAttribute("aria-hidden", "true");
  await advancedToggle.click();
  await expect(advancedFields).toHaveAttribute("data-webui-motion-state", "expand");
  await expect(advancedFields).not.toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => advancedFields.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  await dialog.getByLabel("请求头").fill('{"x-test":"synthetic"}');
  await dialog.getByLabel("超时（毫秒）").fill("0");
  // The Desktop dialog disables its primary action while the form is invalid,
  // so the invalid state is asserted on the control: a disabled action cannot be
  // pressed and cannot send a request.
  await expect(dialog.getByRole("button", { name: "添加服务器" })).toBeDisabled();
  // A disabled action cannot be pressed, so the invalid value is refused before
  // any request exists. The 正整数 message `buildRequest` throws for the same
  // value stays a defensive check behind `canSave`, not a user-facing path.
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) =>
    request.operation === "pluginManagement" && request.body.action === "createMcpServer",
  ))).toBe(false);

  await advancedToggle.click();
  await expect(advancedFields).toHaveAttribute("data-webui-motion-state", "collapse");
  await expect(advancedFields).toHaveAttribute("aria-hidden", "true");
  await expect(advancedFields).toHaveAttribute("inert", "");
  await expect.poll(() => advancedFields.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
  await advancedToggle.click();

  await dialog.getByLabel("超时（毫秒）").fill("1500");
  await expect(dialog.getByRole("button", { name: "添加服务器" })).toBeEnabled();
  await dialog.getByRole("button", { name: "添加服务器" }).click();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) =>
    request.operation === "pluginManagement" && request.body.action === "createMcpServer",
  ))).toBe(true);
  const request = await page.evaluate(() => window.__fixture.requests.find((entry) =>
    entry.operation === "pluginManagement" && entry.body.action === "createMcpServer",
  ));
  expect(request.body.input).toMatchObject({
    name: "local-docs",
    enabled: true,
    config: {
      transport: "http",
      url: "http://127.0.0.1:43121/mcp",
      headers: { "x-test": "synthetic" },
      timeoutMs: 1500,
    },
  });
  await expect(dialog).toHaveCount(0);
});

test("MCP advanced fields use the shared disclosure for open and close", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("listMcpServers", { servers: [] });
    });
  });
  await openManagement(page);
  await page.getByRole("menuitem", { name: "添加 MCP server" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP Server" });
  // The transport is the shared select menu: a trigger plus a portal-rendered
  // option list, not a native <select>.
  await dialog.getByRole("combobox", { name: "传输方式" }).click();
  await page.getByRole("option", { name: "http", exact: true }).click();
  const toggle = dialog.getByRole("button", { name: "高级" });
  const disclosure = dialog.locator("#webui-mcp-advanced-fields");

  await expect(disclosure).toHaveAttribute("data-webui-motion", "disclosure");
  await expect(disclosure).toHaveAttribute("aria-hidden", "true");
  await toggle.click();
  await expect(disclosure).toHaveAttribute("data-webui-motion-state", "expand");
  await expect(disclosure).not.toHaveAttribute("aria-hidden", "true");
  await expect(dialog.getByLabel("请求头")).toBeVisible();

  await toggle.click();
  await expect(disclosure).toHaveAttribute("data-webui-motion-state", "collapse");
  await expect(disclosure).toHaveAttribute("aria-hidden", "true");
  await expect(disclosure).toHaveAttribute("inert", "");
  await expect.poll(() => disclosure.evaluate((element) => element.getBoundingClientRect().height)).toBe(0);
});

test("Git plugin import form is an accessible viewport overlay and previews local fixture data", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setPluginManagementResult("previewGithubPlugin", {
        canImport: true,
        plugin: { summary: { name: "local-plugin", displayName: "Local plugin" } },
      });
    });
  });
  await openManagement(page);
  await page.getByRole("menuitem", { name: "从 Git 仓库导入插件" }).click();
  const dialog = page.getByRole("dialog", { name: "从 Git 仓库导入插件" });
  await expectCenteredDialog(dialog, page, ".webui-plugin-import-body", "block");
  await expectMobileDialog(dialog, page, ".webui-plugin-import-body");
  await dialog.getByRole("textbox", { name: "仓库 URL" }).fill("https://github.com/example/local-plugin");
  await dialog.getByRole("button", { name: "预览" }).click();
  await expect(dialog.getByText("Local plugin")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fixture.requests.some((request) =>
    request.operation === "pluginManagement" && request.body.action === "previewGithubPlugin",
  ))).toBe(true);
});
