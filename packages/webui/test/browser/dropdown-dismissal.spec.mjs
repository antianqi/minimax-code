// The shared dropdown's dismissal contract, measured in the browser.
//
// A dropdown is one layer: the trigger belongs to it, the popup is it, and so
// is the `<label>` that names the trigger. A press on the trigger or on the
// label is therefore the dropdown's own business and not a dismissal — the
// trigger's activation decides whether the popup opens or closes.
//
// The bug this pins: neither the trigger nor the label was inside the popup's
// layer, so a press on either was read as a press outside. The popup was
// dismissed at `pointerdown`, and the click that followed found the popup
// closed and opened it again. A popup that could not be closed.
//
// The surface is the MCP server form's 「传输方式」 picker: a shared select
// menu in a field whose label sits above the trigger, which is the shape
// every dropdown in a form has.

import { expect } from "@playwright/test";

import { configureFixture, openApp, test } from "./harness.mjs";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  await configureFixture(page, () => {
    window.__fixture.setPluginManagementResult("listMcpServers", { servers: [] });
  });
});

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

test("a press on the trigger closes the popup the trigger opened", async ({ page }) => {
  const dialog = await openMcpServerForm(page);
  const trigger = transportPicker(page);
  const options = transportOptions(page);

  await trigger.click();
  await expect(options).toBeVisible();

  // The trigger is part of the popup's own layer, so the press is the
  // trigger's business and not a dismissal: the click that follows toggles.
  await trigger.click();
  await expect(options).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test("a press on the field's label closes the popup it opened", async ({ page }) => {
  const dialog = await openMcpServerForm(page);
  const trigger = transportPicker(page);
  const options = transportOptions(page);
  const label = dialog.locator("label.webui-field-label", { hasText: "传输方式" });

  await trigger.click();
  await expect(options).toBeVisible();

  // The label names the trigger, so it is part of the same layer: the press
  // does not dismiss the popup, and the click the label forwards to the
  // trigger closes it. A label outside the layer would dismiss the popup on
  // the press and open it again on the click.
  await label.click();
  await expect(options).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test("a press outside the popup is still a dismissal", async ({ page }) => {
  const dialog = await openMcpServerForm(page);
  const trigger = transportPicker(page);
  const options = transportOptions(page);

  await trigger.click();
  await expect(options).toBeVisible();

  // The half of the contract this change did not touch: a press outside the
  // popup and its trigger still dismisses it.
  await dialog.getByRole("textbox").first().click();
  await expect(options).toHaveCount(0);
});
