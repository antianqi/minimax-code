// The shared select's keyboard, measured in the browser.
//
// The control used to answer the keyboard two ways at once: the trigger held
// an `aria-activedescendant` AND the options were tabbable buttons. Tab
// therefore walked into the list while the trigger still claimed the focus,
// and the two answers disagreed about where the user was.
//
// The model now is one: the trigger keeps the DOM focus and names the active
// option, the options are not in the tab order and are not focusable at all.
// These cases drive the real control in the real form — the MCP server
// form's 「传输方式」 picker — because the focus and the key order are
// exactly what a rendered string cannot show.
//
// The surface is the same one the dismissal spec drives, because it is a
// shared select under a field's label: the shape every dropdown in a form
// has.

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

/** Opens the MCP server form the way a user does. */
async function openMcpServerForm(page) {
  await openApp(page, "#session=A");
  await page.getByRole("button", { name: "插件" }).first().click();
  await page.getByTestId("plugin-manage-trigger").click();
  await page.getByTestId("plugin-create-trigger").click();
  await page.getByRole("menuitem", { name: "添加 MCP server" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP Server" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The 「传输方式」 picker: a shared select menu under its field's label. */
const transportPicker = (page) =>
  page.getByRole("dialog", { name: "MCP Server" }).getByRole("combobox", { name: "传输方式" });

/** The popup. It is portalled to the document body, so the page addresses it. */
const transportOptions = (page) => page.getByRole("listbox");

/** The option the trigger names, addressed without a CSS id selector. */
function activeOption(page) {
  return page.evaluate(() => {
    const id = document.activeElement?.getAttribute("aria-activedescendant");
    if (!id) return null;
    const option = document.getElementById(id);
    return option ? { id, text: option.textContent, role: option.getAttribute("role") } : null;
  });
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  await configureFixture(page, () => {
    window.__fixture.setPluginManagementResult("listMcpServers", { servers: [] });
  });
});

test("the trigger keeps the focus and names the active option", async ({ page }) => {
  const dialog = await openMcpServerForm(page);
  const trigger = transportPicker(page);
  const options = transportOptions(page);

  await trigger.focus();
  await expect(trigger).toBeFocused();

  // The first arrow opens the list and moves the active option on.
  await trigger.press("ArrowDown");
  await expect(options).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await activeOption(page)).toMatchObject({ role: "option" });

  // Home and End reach the ends of the list, and the trigger keeps naming an
  // option that is in the document.
  await trigger.press("End");
  const last = await activeOption(page);
  expect(last?.text).toBe("sse");
  await trigger.press("Home");
  expect((await activeOption(page))?.text).toBe("stdio");
  await trigger.press("ArrowDown");
  expect((await activeOption(page))?.text).toBe("http");

  // And the named option is the one the list draws as active.
  await expect(page.locator('[role="option"].is-active')).toHaveText("http");
  await expect(dialog).toBeVisible();
});

test("Enter takes the option, closes the list, and leaves the focus where it was", async ({ page }) => {
  await openMcpServerForm(page);
  const trigger = transportPicker(page);
  const options = transportOptions(page);

  await trigger.focus();
  await trigger.press("ArrowDown");
  await trigger.press("ArrowDown");
  await trigger.press("Enter");

  await expect(options).toHaveCount(0);
  // The focus is still on the trigger: the option was chosen by the key, and
  // choosing it must not throw the focus away.
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText(/http/u);
});

test("Space opens the list, and Escape closes it and returns the focus", async ({ page }) => {
  await openMcpServerForm(page);
  const trigger = transportPicker(page);
  const options = transportOptions(page);

  await trigger.focus();
  await trigger.press(" ");
  await expect(options).toBeVisible();

  await trigger.press("Escape");
  await expect(options).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("Tab leaves the control, and the list closes behind it", async ({ page }) => {
  await openMcpServerForm(page);
  const trigger = transportPicker(page);
  const options = transportOptions(page);

  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(options).toBeVisible();

  await trigger.press("Tab");
  // The list holds no focus of its own, so an open list behind the focus
  // would be a floating thing with nothing in it.
  await expect(options).toHaveCount(0);
  await expect(trigger).not.toBeFocused();
});

test("the options are not in the tab order, and a press on one keeps the focus on the trigger", async ({ page }) => {
  await openMcpServerForm(page);
  const trigger = transportPicker(page);
  const options = transportOptions(page);

  await trigger.click();
  await expect(options).toBeVisible();

  // An option is not a control: the trigger is. Nothing in the list can be
  // reached with Tab, and nothing in it can hold the focus.
  const tabbable = await options.evaluate((element) =>
    [...element.querySelectorAll('[role="option"]')].map((option) => ({
      tabIndex: option.tabIndex,
      tag: option.tagName,
      hasTabindex: option.hasAttribute("tabindex"),
    })),
  );
  expect(tabbable.length).toBeGreaterThan(0);
  for (const option of tabbable) {
    expect(option.tabIndex).toBe(-1);
    expect(option.hasTabindex).toBe(false);
  }

  // A press on an option takes the choice, and the focus stays on the
  // trigger that owns the list.
  await options.getByRole("option", { name: "http", exact: true }).click();
  await expect(options).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveText(/http/u);
});

test("the row the keyboard is on is visible", async ({ page }) => {
  await openMcpServerForm(page);
  const trigger = transportPicker(page);
  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(page.locator('[role="option"].is-active')).toHaveText("http");

  // The keyboard is the only way into the list, so the row it is on has to
  // be visible: the active row takes a wash the resting rows do not.
  const fills = await page
    .locator('[role="option"]')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(fills.length).toBeGreaterThan(1);
  expect(new Set(fills).size).toBeGreaterThan(1);
});

test("the shared dialog draws its own frame", async ({ page }) => {
  // The SSH terminal window was the one window in the client that dressed the
  // dialog shell in a business's colours, from another business's
  // stylesheet. The dialog owns the frame now, and this is the frame every
  // dialog draws — asserted on a dialog that is definitely open.
  await openMcpServerForm(page);
  const surface = page.locator(".webui-dialog-surface");
  await expect(surface).toBeVisible();
  const frame = await surface.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.width,
      borderRadius: style.borderRadius,
      background: style.backgroundColor,
      borderTop: style.borderTopWidth,
    };
  });
  // 640px is the modal shell's standard width and 16px its radius; the
  // colours are the theme's own surfaces, not the SSH window's dark frame.
  expect(frame.width).toBe("640px");
  expect(frame.borderRadius).toBe("16px");
  expect(frame.background).not.toBe("rgb(13, 18, 27)");
});

for (const theme of ["light", "dark"]) {
  test(`the open select is drawn in the ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openMcpServerForm(page);
    const trigger = transportPicker(page);
    await trigger.focus();
    await trigger.press("ArrowDown");
    await expect(transportOptions(page)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(theme === "dark");
    if (evidenceDir) {
      await page.screenshot({ path: `${evidenceDir}/select-open-${theme}.png` });
    }
  });
}
