// The Host's own rules, applied to a page's tool call.
//
// One seam: `createMiniAppToolRulePort(source)` — the port the gateway judges a page by.
// What it proves: global rules and the global mode decide, exactly as they do on a
// turn; `off` allows everything a rule does not deny; `bypassPermissions` turns an `ask`
// into an `allow` but leaves a `deny` standing; and "always allow" writes the global
// allow rule rather than a Mini App's own copy. What it does not cover: where those
// rules are stored (the Host's), and the prompt an `ask` reaches.

import { describe, expect, it } from "vitest";

import type { PermissionRule } from "@mavis/permission";

import { createMiniAppToolRulePort } from "../../../src/service/miniapp/tool-rules.js";

function rule(toolName: string, ruleBehavior: "allow" | "deny" | "ask"): PermissionRule {
  return { source: "global", ruleBehavior, ruleValue: { toolName } };
}

function source(input: { mode?: string; rules?: readonly PermissionRule[] } = {}) {
  const written: string[] = [];
  const port = createMiniAppToolRulePort({
    readPermissionMode: () => input.mode,
    readDataDir: () => "/tmp/miniapp-data",
    listGlobalRules: async () => input.rules ?? [],
    addGlobalAllowRule: async (name) => {
      written.push(name);
    },
  });
  return { port, written };
}

describe("the rules a page's tool call meets", () => {
  it("allows a tool the global rules allow", async () => {
    const { port } = source({ rules: [rule("mcp__files__read", "allow")] });

    expect((await port.snapshot()).check("mcp__files__read", {})).toBe("allow");
  });

  it("refuses a tool the global rules deny", async () => {
    const { port } = source({ rules: [rule("connector__github__delete", "deny")] });

    expect((await port.snapshot()).check("connector__github__delete", {})).toBe("deny");
  });

  it("asks when a rule says ask, which is the only way a page's call prompts", async () => {
    const { port } = source({ rules: [rule("mcp__files__write", "ask")] });

    expect((await port.snapshot()).check("mcp__files__write", {})).toBe("ask");
  });

  it("allows a tool no rule mentions, because the Host has no checker that finds it risky", async () => {
    const { port } = source({ rules: [] });

    // The engine's own answer, pinned: a page's tools are named `mcp__*` / `connector__*`
    // and no checker speaks for them, so the absence of a rule is not a prompt.
    expect((await port.snapshot()).check("mcp__files__write", {})).toBe("allow");
  });

  it("allows everything under off, because nothing asks and nothing denies", async () => {
    const { port } = source({ mode: "off" });

    expect((await port.snapshot()).check("mcp__files__write", {})).toBe("allow");
  });

  it("turns an ask into an allow under bypassPermissions, and keeps a deny", async () => {
    const { port } = source({
      mode: "bypassPermissions",
      rules: [rule("connector__github__delete", "deny")],
    });
    const snapshot = await port.snapshot();

    expect(snapshot.check("mcp__files__write", {})).toBe("allow");
    expect(snapshot.check("connector__github__delete", {})).toBe("deny");
  });

  it("writes the global allow rule for always-allow, not a Mini App copy", async () => {
    const { port, written } = source();

    await port.allowAlways("mcp__files__read");

    expect(written).toEqual(["mcp__files__read"]);
  });

  it("reads the rules again for each snapshot, so a written rule is seen", async () => {
    let reads = 0;
    const port = createMiniAppToolRulePort({
      readPermissionMode: () => "default",
      readDataDir: () => "/tmp/miniapp-data",
      listGlobalRules: async () => {
        reads += 1;
        return reads === 1 ? [rule("mcp__files__read", "ask")] : [rule("mcp__files__read", "allow")];
      },
      addGlobalAllowRule: async () => undefined,
    });

    expect((await port.snapshot()).check("mcp__files__read", {})).toBe("ask");
    expect((await port.snapshot()).check("mcp__files__read", {})).toBe("allow");
  });
});
