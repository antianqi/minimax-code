import { expect } from "@playwright/test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { test } from "./harness.mjs";

for (const accepted of [true, false]) test(`B03 ${accepted ? "accepted" : "refused"} A canvas completion preserves B draft and optimistic preview`, async ({ page }) => {
  // Mount the production component, query provider and owners. Only the port
  // and parent navigation control are scripted; the consuming callback, form
  // submission and pointer preview are the actual WorkspaceCanvas code.
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../../../..", import.meta.url)), loader: "tsx", contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { WorkspaceCanvas } from "./packages/webui/src/client/features/workspace/ui/WorkspaceCanvas.tsx";
      import { WebuiWorkspaceQueriesProvider } from "./packages/webui/src/client/bindings/use-query-state.tsx";
      import { createWebuiWorkspaceQueries } from "./packages/webui/src/client/features/workspace/application/workspace-queries.ts";
      import { createWebuiWorkspaceReviewOwner } from "./packages/webui/src/client/features/review/application/workspace-review-owner.public.ts";
      const pending = [];
      window.canvasHarness = { pending, settled: [], resolve(sessionId, accepted = true) {
        const index = pending.findIndex((r) => r.sessionId === sessionId);
        if (index < 0) throw new Error("No pending canvas write for " + sessionId);
        const request = pending.splice(index, 1)[0];
        if (accepted) request.resolve({ operationId: request.operation.operationId, document: documentFor(sessionId) });
        else request.reject(new Error("Synthetic refusal"));
      } };
      function documentFor(sessionId) { return { schemaVersion: 1, canvasId: sessionId, sessionId, changeSeq: 1, updatedAtMs: 1,
        nodes: [{ id: "node-B", kind: "file", file: { relativePath: "B.md" }, layout: { x: 100, y: 150, width: 240, height: 160, zIndex: 0 } }] }; }
      const port = { readCanvas: async ({ sessionId }) => documentFor(sessionId),
        applyCanvas: (request) => new Promise((resolve, reject) => pending.push({ ...request, resolve, reject })) };
      const queries = createWebuiWorkspaceQueries({ port, review: createWebuiWorkspaceReviewOwner({ port: {} }) });
      const apply = queries.canvas.applyCanvas;
      queries.canvas.applyCanvas = (...args) => apply(...args).then((accepted) => {
        window.canvasHarness.settled.push({ sessionId: args[0], accepted }); return accepted;
      });
      function Harness() { const [sessionId, select] = useState("A"); return <>
        <button onClick={() => select("B")}>Navigate to B</button>
        <div style={{ position: "relative", width: 1100, height: 650 }}>
          <WebuiWorkspaceQueriesProvider queries={queries}><WorkspaceCanvas sessionId={sessionId} /></WebuiWorkspaceQueriesProvider>
        </div></>; }
      createRoot(document.getElementById("root")).render(<Harness />);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const serverId = test.info().config.metadata.webuiBrowserServerId;
  await page.route("**/canvas-harness", (route) => route.fulfill({ contentType: "text/html", body:
    `<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script>window.__WEBUI_TEST_SERVER_ID__=${JSON.stringify(serverId)};</script><script src="/canvas-harness.js"></script></body></html>` }));
  await page.route("**/canvas-harness.js", (route) => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto("/canvas-harness");
  const canvas = page.locator(".webui-canvas-content");
  const input = canvas.getByRole("textbox");
  await input.fill("A-new.md");
  await canvas.getByRole("button", { name: "添加到画布" }).click();
  await expect.poll(() => page.evaluate(() => window.canvasHarness.pending.filter((r) => r.sessionId === "A").length)).toBe(1);
  await page.getByRole("button", { name: "Navigate to B" }).click();
  await input.fill("B-draft.md");
  const node = canvas.locator('[data-canvas-node-id="node-B"]');
  await expect(node).toBeVisible();
  const box = await node.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 50);
  await page.mouse.down(); await page.mouse.move(box.x + 70, box.y + 90); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.canvasHarness.pending.filter((r) => r.sessionId === "B").length)).toBe(1);
  await expect(node).toHaveCSS("left", "140px");
  const preview = await node.getAttribute("style");
  await page.evaluate((accepted) => window.canvasHarness.resolve("A", accepted), accepted);
  await expect.poll(() => page.evaluate(() => window.canvasHarness.settled)).toEqual([{ sessionId: "A", accepted }]);
  await expect.soft(input).toHaveValue("B-draft.md");
  await expect.soft(node).toHaveAttribute("style", preview);
  await page.screenshot({ path: test.info().outputPath("B-draft-preview.png") });
  await page.evaluate(() => window.canvasHarness.resolve("B"));
  await expect(node).toHaveCSS("left", "100px");
  await canvas.getByRole("button", { name: "添加到画布" }).click();
  await expect.poll(() => page.evaluate(() => window.canvasHarness.pending.length)).toBe(1);
  await page.evaluate(() => window.canvasHarness.resolve("B"));
  await expect(input).toHaveValue("");
});
