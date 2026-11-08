import { expect } from "@playwright/test";
import { configureFixture, openApp, test } from "./harness.mjs";

for (const theme of ["light", "dark"]) {
  test(`IM authorization follows the selected bot and releases polling in ${theme}`, async ({ page }) => {
    await page.clock.install();
    await page.addInitScript((value) => localStorage.setItem("webui-theme", value), theme);
    await configureFixture(page, () => {
      window.__fixture.setResponse("listChannelConnections", { connections: ["a", "b"].map((connectionId) => ({
        connectionId, channel: "wechat", agentName: "mavis", projectKey: null, state: "configured",
        wechat: { name: connectionId },
      })) });
      window.__fixture.setResponse("startChannelWechatBind", { ok: true, sessionId: "qr", qrContent: "https://example.invalid/qr" });
      window.__fixture.setResponse("getChannelWechatBindStatus", { status: "pending" });
      window.__fixture.delayNext("getChannelWechatBindStatus", { connectionId: "a" });
    });
    await openApp(page);
    await page.getByRole("button", { name: "远程", exact: true }).click();
    await page.getByText("接入 IM", { exact: true }).click();
    const qr = page.getByTestId("authorization-qr-code");
    await expect(qr).toBeVisible();
    const box = await qr.boundingBox();
    expect(box.width).toBe(140);
    expect(box.height).toBe(140);
    await page.clock.runFor(2_100);
    await expect.poll(() => page.evaluate(() => window.__fixture.pending.some((request) =>
      request.operation === "getChannelWechatBindStatus" && request.body.connectionId === "a"))).toBe(true);
    await page.locator('[data-webui-channel-row="b"]').click();
    await expect.poll(() => page.evaluate(() => window.__fixture.requests.filter((request) =>
      request.operation === "startChannelWechatBind").at(-1)?.body.connectionId)).toBe("b");
    await page.evaluate(() => window.__fixture.resolve("getChannelWechatBindStatus", { connectionId: "a" }, { status: "confirmed" }));
    await expect(qr).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`authorization-${theme}.png`) });
    await page.getByText("远程控制", { exact: true }).click();
    const reads = await page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "getChannelWechatBindStatus").length);
    await page.clock.runFor(6_000);
    expect(await page.evaluate(() => window.__fixture.requests.filter((request) => request.operation === "getChannelWechatBindStatus").length)).toBe(reads);
  });
}

test("a presenter close supersedes an opening panel before its capability settles", async ({ page }) => {
  await configureFixture(page, () => {
    window.__fixture.setResponse("listMiniApps", { miniApps: [{
      pluginId: "app", displayName: "App", detached: false, presentationRevision: 0,
      runtime: { kind: "process", status: "running" },
    }] });
    window.__fixture.delayNext("openMiniApp", { pluginId: "app" });
  });
  await openApp(page);
  await page.evaluate(() => window.__fixture.emitMiniAppPresenter({
    epoch: "service", revision: 1, action: "open", sessionId: "B", pluginId: "app",
  }));
  await expect.poll(() => page.evaluate(() => window.__fixture.pending.some((request) => request.operation === "openMiniApp"))).toBe(true);
  await page.evaluate(() => {
    window.__fixture.emitMiniAppPresenter({ epoch: "service", revision: 2, action: "close", sessionId: "B", pluginId: "app" });
    window.__fixture.resolve("openMiniApp", { pluginId: "app" }, { pluginId: "app", viewUrl: "/__closed-app", connection: 1 });
  });
  await expect.poll(() => page.evaluate(() => window.__fixture.replies.some((reply) => reply.operation === "listMiniApps"))).toBe(true);
  await expect(page.getByTestId("miniapp-view-frame")).toHaveCount(0);
  await expect(page.getByTestId("workspace-miniapp-tab")).toHaveCount(0);
  await expect(page).toHaveURL(/#session=B$/);
});
