// What a waiting tool prompt looks like on screen.
//
// One seam: `MiniAppToolApprovals` rendered to static markup. What it proves: nothing is
// drawn when nothing is waiting; a prompt names the tool and shows the arguments preview
// the runtime bounded; the three answers are all offered, and the one that writes a rule
// says so; and a second waiting prompt is reported by count rather than drawn. What it
// does not cover: the click handlers reaching the runtime (the workflows' own tests) and
// the panel's styling.

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MiniAppToolApprovals } from "../../src/client/features/miniapp/ui/MiniAppToolApprovals.public.js";
import type { WebuiMiniAppToolApprovalPrompt } from "../../src/shared/contracts/miniapp-tools.js";

function prompt(overrides: Partial<WebuiMiniAppToolApprovalPrompt> = {}): WebuiMiniAppToolApprovalPrompt {
  return {
    requestId: "req-1",
    mode: "call",
    pluginId: "pet",
    tools: [
      {
        name: "mcp__files__read",
        argumentsPreview: '{\n  "path": "notes.md"\n}',
      },
    ],
    ...overrides,
  };
}

function render(prompts: readonly WebuiMiniAppToolApprovalPrompt[]): string {
  return renderToStaticMarkup(
    <MiniAppToolApprovals prompts={prompts} onAnswer={() => undefined} />,
  );
}

describe("a waiting tool prompt", () => {
  it("draws nothing when nothing is waiting", () => {
    assert.equal(render([]), "");
  });

  it("names the tool, shows the arguments preview, and offers all three answers", () => {
    const html = render([prompt()]);

    assert.match(html, /允许调用 mcp__files__read？/);
    assert.match(html, /notes\.md/);
    assert.match(html, /拒绝/);
    assert.match(html, /允许一次/);
    assert.match(html, /始终允许/);
    // The one answer that outlives the call says so, in its own words.
    assert.match(html, /写入全局允许规则/);
  });

  it("asks about a request prompt as a question about the tool, not about one call", () => {
    assert.match(render([prompt({ mode: "request" })]), /允许这个应用使用 mcp__files__read？/);
  });

  it("reports a second waiting prompt by count instead of drawing it", () => {
    const html = render([prompt(), prompt({ requestId: "req-2" })]);

    assert.match(html, /还有 1 个请求在等待/);
    // The first prompt is the one drawn; the second's id is not.
    assert.equal(html.includes("req-2"), false);
  });
});
