// A provider that drives more than one browser lets a call name the browser it
// means. This covers the schema the model is shown: a name the provider offers
// is accepted, a name it does not offer is not, and a provider with one browser
// is never asked to choose. It also covers what the call does with the name:
// a name the provider does not offer is refused in the words of that refusal,
// and a name it does offer travels to the provider.

import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import { buildLocalBrowserRuntimeTools } from "../../src/desktop/local-browser.js";
import type {
  LocalBrowserAdapter,
  LocalBrowserSkillSessionStore,
  LocalBrowserToolAction,
} from "../../src/desktop/types.js";

const TOOL_CONTEXT = { sessionId: "session-a", turnId: "turn-a" } as const;

/** A provider that drives the browsers it is asked to drive. */
function adapterWith(
  browsers?: readonly string[],
  onExecute?: (action: LocalBrowserToolAction, input: Record<string, unknown>) => void,
): LocalBrowserAdapter {
  return {
    getCapabilities: () => ({
      provider: "test-browser",
      version: 1,
      actions: ["navigate"],
      ...(browsers ? { browsers } : {}),
    }),
    execute: async (_ctx, action, input) => {
      onExecute?.(action, input);
      return { success: true };
    },
  };
}

/** The skill receipt that says the Browser skill was already loaded. */
function loadedSkillStore(): LocalBrowserSkillSessionStore {
  return {
    requiredSkillName: "control-in-app-browser",
    hasLoaded: () => true,
    markLoaded: () => {},
    clearSession: () => {},
  };
}

/** The compact Browser tool. */
function compactTool(adapter: LocalBrowserAdapter, skillLoaded = false) {
  const tools = buildLocalBrowserRuntimeTools(adapter, {
    exposure: "compact",
    ...(skillLoaded ? { browserSkillSessionStore: loadedSkillStore() } : {}),
  });
  const tool = tools[0];
  if (!tool) throw new Error("no browser tool was built");
  return tool;
}

/** The schema the model is shown for a compact Browser call. */
function compactSchema(adapter: LocalBrowserAdapter) {
  return compactTool(adapter).def.schema;
}

describe("a browser call that names its browser", () => {
  it("accepts a name the provider offers", () => {
    const schema = compactSchema(adapterWith(["isolated-chromium", "edge"]));

    expect(
      Value.Check(schema, {
        action: "navigate",
        input: { url: "https://example.test/", browser: "edge" },
      }),
    ).toBe(true);
  });

  it("refuses a name the provider does not offer", () => {
    const schema = compactSchema(adapterWith(["isolated-chromium", "edge"]));

    expect(
      Value.Check(schema, {
        action: "navigate",
        input: { url: "https://example.test/", browser: "safari" },
      }),
    ).toBe(false);
  });

  it("does not offer a name to a provider with one browser", () => {
    const schema = compactSchema(adapterWith());

    // A provider with one browser has nothing to choose, so the field is not
    // part of what the model is shown.
    expect(
      Value.Check(schema, {
        action: "navigate",
        input: { url: "https://example.test/", browser: "edge" },
      }),
    ).toBe(false);
  });

  it("refuses a name the provider does not offer, saying which it offers", async () => {
    const tool = compactTool(adapterWith(["isolated-chromium", "edge"]));

    const result = await tool.impl.execute(TOOL_CONTEXT, {
      action: "navigate",
      input: { url: "https://example.test/", browser: "safari" },
    });

    // A name is refused rather than ignored: a call that believes it is in a
    // browser it is not in is worse than a refusal.
    expect(result.isError).toBe(true);
    expect(result.details).toMatchObject({ code: "browser_command_invalid" });
    expect(result.text).toContain('The browser "safari" is not one this provider offers.');
    expect(result.text).toContain("isolated-chromium, edge");
  });

  it("hands the named browser to the provider", async () => {
    const seen: Array<{ action: LocalBrowserToolAction; input: Record<string, unknown> }> = [];
    const tool = compactTool(
      adapterWith(["isolated-chromium", "edge"], (action, input) => {
        seen.push({ action, input });
      }),
      true,
    );

    await tool.impl.execute(TOOL_CONTEXT, {
      action: "navigate",
      input: { url: "https://example.test/", browser: "edge" },
    });

    // The name reaches the provider: it is how the call says which browser it
    // means, and the provider is what turns it into a page.
    expect(seen).toEqual([
      { action: "navigate", input: { url: "https://example.test/", browser: "edge" } },
    ]);
  });
});
