// The SSH terminal window, measured in the browser.
//
// The window is a shared dialog, and the shared dialog owns the frame: the
// surface, the header, the heading and the close control. What the SSH
// business owns is the chrome it puts in that frame — the mark, the
// connection state — and the viewport the terminal is drawn in.
//
// Two things are measured here that a source reading cannot answer.
//
// The first is the capacity. The window used to be widened by rules in
// another business's stylesheet, reaching into the dialog's own internals;
// when those rules went, the window quietly became 800px wide and the
// terminal inside it lost a quarter of its columns. The window now asks the
// shared shell for the size it needs, and this measures what it got.
//
// The second is the light theme. The chrome in the header was coloured for a
// dark frame of its own and read at 2.3:1 on the shared frame; it is drawn
// with the theme's tokens now, and this measures the contrast it actually
// has.

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

/** The saved hosts the fixture answers with. */
function hosts(aliases) {
  return aliases.map((alias) => ({
    alias,
    displayName: alias,
    endpoint: { kind: "manual", host: "127.0.0.1", port: 22 },
    enabled: true,
    status: "ready",
  }));
}

/** The terminal session the fixture answers the open with. */
const OPEN_TERMINAL = { terminalId: "ssh-1", alias: "demo", status: "running" };

/** Opens the SSH tab of the connection settings. */
async function openSshSettings(page) {
  await openApp(page, "#session=A");
  await page.getByTestId("sidebar-user-menu-trigger").click();
  await page.getByTestId("user-menu-settings").click();
  await expect(page.locator('[role="dialog"][aria-label="设置"]')).toBeVisible();
  await page.locator('.webui-settings-nav [data-menu-key="connection"]').click();
  await page.getByTestId("connection-section-ssh").click();
  await expect(page.getByTestId("ssh-connections-section")).toBeVisible();
}

/** Opens the terminal of a saved host, the way the row's menu does. */
async function openTerminal(page, alias) {
  await page.locator(`[data-webui-ssh-more="${alias}"]`).click();
  await page.locator(`[data-webui-ssh-terminal="${alias}"]`).click();
  const dialog = page.getByTestId("ssh-remote-terminal-dialog");
  await expect(dialog).toBeVisible();
  // The row's menu steps aside for the thing it opened: a menu left up over
  // the window covers it.
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  return dialog;
}

/**
 * The contrast between two computed colours.
 *
 * The ratio is the one the accessibility guidance uses, computed in the page
 * from the colours the browser actually resolved — a token's value is not
 * what a surface ends up being.
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

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => console.error("BROWSER_PAGE_ERROR", error.stack ?? error.message));
  // The setup runs in the page, so the data is handed over rather than
  // closed over: the fixture answers the SSH reads with a saved host, an
  // empty project list, and a terminal session that is already running.
  await page.addInitScript((value) => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() => {
      window.__fixture.setResponse("listSshConnections", value.connections);
      window.__fixture.setResponse("listSshProjects", value.projects);
      window.__fixture.setResponse("openSshTerminal", value.session);
    });
  }, { connections: hosts(["demo"]), projects: [], session: OPEN_TERMINAL });
});

for (const theme of ["light", "dark"]) {
  test(`the terminal window keeps the capacity the shell gives it in the ${theme} theme`, async ({ page }) => {
    await useTheme(page, theme);
    await openSshSettings(page);
    await openTerminal(page, "demo");

    const surface = page.getByTestId("ssh-remote-terminal-dialog");
    const frame = await surface.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        maxHeight: style.maxHeight,
        background: style.backgroundColor,
        radius: style.borderRadius,
      };
    });

    // The window is as wide as the shell's expanded size asks for on this
    // viewport: 1040px when the viewport has room for it, and the viewport's
    // own margin when it does not. It is never the 800px of the ordinary
    // wide dialog — that is the regression this measures.
    expect(frame.width).toBe(1040);
    expect(frame.width).toBeGreaterThan(800);
    expect(frame.maxHeight).toBe("852px");
    expect(frame.radius).toBe("16px");

    // The frame is the shared dialog's: the theme's own surface, not a
    // business's dark frame.
    expect(frame.background).not.toBe("rgb(13, 18, 27)");

    // The close control is there and it is on screen: a window nobody can
    // close is a window nobody can leave.
    const close = page.getByTestId("ssh-remote-terminal-close");
    await expect(close).toBeVisible();
    const closeBox = await close.boundingBox();
    expect(closeBox).not.toBeNull();
    expect(closeBox?.width).toBeGreaterThan(0);

    // The terminal is mounted and drawn: the host is there and xterm has put
    // its screen inside it.
    const host = page.locator('[data-webui-component="ssh-terminal"]');
    await expect(host).toBeVisible();
    await expect(host.locator(".xterm-screen")).toHaveCount(1);
    const hostBox = await host.boundingBox();
    expect(hostBox?.width ?? 0).toBeGreaterThan(900);

    // The dialog took the focus when it opened, so the keyboard is inside the
    // window rather than behind it.
    const focusedInside = await page.evaluate(() => {
      const surface = document.querySelector('[data-testid="ssh-remote-terminal-dialog"]');
      return Boolean(surface && document.activeElement && surface.contains(document.activeElement));
    });
    expect(focusedInside).toBe(true);

    if (evidenceDir) {
      await page.screenshot({ path: `${evidenceDir}/ssh-terminal-${theme}.png` });
    }
  });
}

test("the connection state is readable in the light theme", async ({ page }) => {
  await useTheme(page, "light");
  await openSshSettings(page);
  await openTerminal(page, "demo");

  const status = page.locator(".webui-ssh-terminal-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveText(/已连接/u);
  await expect(status).toHaveClass(/is-connected/u);

  // The words are the meaning, so they have to be readable on the wash they
  // are drawn on.
  const colours = await status.evaluate((element) => ({
    text: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
    dot: element.querySelector("svg") ? getComputedStyle(element.querySelector("svg")).color : "",
  }));
  expect(await contrast(page, colours.text, colours.background)).toBeGreaterThanOrEqual(4.5);
  // The dot beside the words carries the hue, and it is a graphic, so it
  // clears the non-text bar.
  expect(await contrast(page, colours.dot, colours.background)).toBeGreaterThanOrEqual(3);

  if (evidenceDir) {
    await page.screenshot({ path: `${evidenceDir}/ssh-terminal-status-light.png` });
  }
});

test("the window fits a constrained viewport without losing the terminal", async ({ page }) => {
  await useTheme(page, "light");
  await page.setViewportSize({ width: 720, height: 640 });
  await openSshSettings(page);
  await openTerminal(page, "demo");

  const surface = page.getByTestId("ssh-remote-terminal-dialog");
  const frame = await surface.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, maxHeight: getComputedStyle(element).maxHeight };
  });

  // The window is bounded by the viewport's own margin.
  expect(frame.width).toBe(672);
  expect(frame.maxHeight).toBe("592px");
  expect(frame.height).toBeLessThanOrEqual(592);

  // And the terminal is still there: a window that fits is a window with a
  // terminal in it.
  const host = page.locator('[data-webui-component="ssh-terminal"]');
  await expect(host).toBeVisible();
  const hostBox = await host.boundingBox();
  expect(hostBox?.width ?? 0).toBeGreaterThan(560);

  if (evidenceDir) {
    await page.screenshot({ path: `${evidenceDir}/ssh-terminal-constrained.png` });
  }
});
