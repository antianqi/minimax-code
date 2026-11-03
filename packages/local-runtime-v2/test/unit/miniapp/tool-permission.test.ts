// The rule a Mini App's tool call meets, and what happens when the rule says "ask".
//
// One seam: the judgement functions, driven against scripted rule and approval ports.
// What it proves is the answer a page gets for each rule verdict, and the three
// fallbacks that keep a page from running a tool nobody approved: no rule port, a rule
// store that cannot be read, and an approval prompt that nobody can answer. What it
// does not cover: the rule engine itself (its own tests), the prompt UI, and the bridge
// that carries a page's request here.

import { describe, expect, it } from "vitest";

import {
  currentMiniAppToolRules,
  judgeMiniAppToolCall,
  requestMiniAppToolPermissions,
} from "../../../src/service/miniapp/tool-permission.js";

const TARGET = { name: "mcp__files__read" } as const;
const BUILTIN = { name: "read_file", builtin: true } as const;

function rules(verdict: "allow" | "ask" | "deny", options: { readonly throws?: boolean } = {}) {
  const written: string[] = [];
  return {
    written,
    port: {
      snapshot: async () => ({
        check: () => {
          if (options.throws === true) throw new Error("rule store unhealthy");
          return verdict;
        },
      }),
      allowAlways: async (name: string) => {
        written.push(name);
      },
    },
  };
}

function approvals(answer: "allow" | "deny" | "allowAlways" | "unavailable", names?: string[]) {
  const asked: unknown[] = [];
  return {
    asked,
    port: {
      request: async (input: unknown) => {
        asked.push(input);
        return answer === "unavailable" ? "unavailable" : { decision: answer, ...(names ? { names } : {}) };
      },
    },
  };
}

describe("the rule a Mini App tool call meets", () => {
  it("lets a builtin through without reading any rule", async () => {
    const { port } = rules("deny");
    const judgement = await judgeMiniAppToolCall(
      { permissions: port },
      { pluginId: "pet", target: BUILTIN, arguments: {} },
    );

    expect(judgement.rule).toBe("builtin");
  });

  it("asks when the Host has no rule port at all", async () => {
    // A Host that cannot state a rule has not allowed anything: the call still has to
    // be approved, and with no prompt it fails closed.
    await expect(
      judgeMiniAppToolCall({}, { pluginId: "pet", target: TARGET, arguments: {} }),
    ).rejects.toMatchObject({ code: "TOOL_APPROVAL_REQUIRED" });
  });

  it("asks rather than allows when the rule store cannot be read", async () => {
    const { port } = rules("allow", { throws: true });

    await expect(
      judgeMiniAppToolCall({ permissions: port }, { pluginId: "pet", target: TARGET, arguments: {} }),
    ).rejects.toMatchObject({ code: "TOOL_APPROVAL_REQUIRED" });
  });

  it("runs a call the rules allow, without asking anyone", async () => {
    const { port } = rules("allow");
    const { port: prompt, asked } = approvals("deny");

    const judgement = await judgeMiniAppToolCall(
      { permissions: port, approvals: prompt },
      { pluginId: "pet", target: TARGET, arguments: {} },
    );

    expect(judgement.rule).toBe("allow");
    expect(asked).toEqual([]);
  });

  it("refuses a call the rules deny, and does not ask anyone either", async () => {
    const { port } = rules("deny");
    const { port: prompt, asked } = approvals("allow");

    await expect(
      judgeMiniAppToolCall(
        { permissions: port, approvals: prompt },
        { pluginId: "pet", target: TARGET, arguments: {} },
      ),
    ).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED", disposition: "not_dispatched" });
    expect(asked).toEqual([]);
  });

  it("takes an ask to the prompt and runs the call when the person allows it", async () => {
    const { port } = rules("ask");
    const { port: prompt, asked } = approvals("allow");

    const judgement = await judgeMiniAppToolCall(
      { permissions: port, approvals: prompt },
      { pluginId: "pet", target: TARGET, arguments: { path: "a.txt" } },
    );

    expect(judgement.decision).toBe("allow");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ mode: "call", pluginId: "pet" });
  });

  it("refuses when the person declines, and records the decision", async () => {
    const { port } = rules("ask");
    const { port: prompt } = approvals("deny");

    await expect(
      judgeMiniAppToolCall(
        { permissions: port, approvals: prompt },
        { pluginId: "pet", target: TARGET, arguments: {} },
      ),
    ).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED" });
  });

  it("writes the rule when the person says always, and still runs this call", async () => {
    const { port, written } = rules("ask");
    const { port: prompt } = approvals("allowAlways");

    const judgement = await judgeMiniAppToolCall(
      { permissions: port, approvals: prompt },
      { pluginId: "pet", target: TARGET, arguments: {} },
    );

    expect(judgement.decision).toBe("allowAlways");
    expect(written).toEqual(["mcp__files__read"]);
    expect(judgement.ruleWriteFailed).toBe(false);
  });

  it("keeps the answer when the rule write fails, because the person still allowed it", async () => {
    const { port } = rules("ask");
    const failing = {
      snapshot: port.snapshot,
      allowAlways: async () => {
        throw new Error("disk full");
      },
    };
    const { port: prompt } = approvals("allowAlways");

    const judgement = await judgeMiniAppToolCall(
      { permissions: failing, approvals: prompt },
      { pluginId: "pet", target: TARGET, arguments: {} },
    );

    expect(judgement.ruleWriteFailed).toBe(true);
  });
});

describe("the rules a listing meets", () => {
  it("judges every tool against one read of the rules", async () => {
    let reads = 0;
    const port = {
      snapshot: async () => {
        reads += 1;
        return { check: (name: string) => (name === "mcp__files__read" ? "allow" : "deny") };
      },
      allowAlways: async () => undefined,
    };

    const verdicts = await currentMiniAppToolRules(
      [{ name: "mcp__files__read" }, { name: "mcp__files__write" }, { name: "read_file", builtin: true }],
      port,
    );

    expect(verdicts).toEqual(["allow", "deny", "allow"]);
    expect(reads).toBe(1);
  });

  it("calls everything ask when there is no rule port", async () => {
    expect(await currentMiniAppToolRules([{ name: "a" }, { name: "b" }], undefined)).toEqual([
      "ask",
      "ask",
    ]);
  });
});

describe("asking for a set of tools", () => {
  it("keeps allowed and denied tools out of the prompt", async () => {
    const port = {
      snapshot: async () => ({
        check: (name: string) =>
          name === "allowed" ? "allow" : name === "denied" ? "deny" : "ask",
      }),
      allowAlways: async () => undefined,
    };
    const { port: prompt, asked } = approvals("deny");

    const outcome = await requestMiniAppToolPermissions(
      { permissions: port, approvals: prompt },
      { pluginId: "pet", targets: [{ name: "allowed" }, { name: "denied" }, { name: "asked" }] },
    );

    expect(outcome.approvalRequired).toBe(false);
    expect(asked).toHaveLength(1);
    // Only the `ask` tool was put in front of the person.
    expect(asked[0]).toMatchObject({ mode: "request", tools: [{ name: "asked" }] });
  });

  it("writes a rule only for the tools the person ticked", async () => {
    const written: string[] = [];
    const port = {
      snapshot: async () => ({ check: () => "ask" }),
      allowAlways: async (name: string) => {
        written.push(name);
      },
    };
    const { port: prompt } = approvals("allowAlways", ["b"]);

    await requestMiniAppToolPermissions(
      { permissions: port, approvals: prompt },
      { pluginId: "pet", targets: [{ name: "a" }, { name: "b" }] },
    );

    expect(written).toEqual(["b"]);
  });

  it("says an approval is required when nobody can be asked", async () => {
    const port = { snapshot: async () => ({ check: () => "ask" }), allowAlways: async () => undefined };

    const outcome = await requestMiniAppToolPermissions(
      { permissions: port },
      { pluginId: "pet", targets: [{ name: "a" }] },
    );

    expect(outcome.approvalRequired).toBe(true);
  });

  it("does not ask at all when nothing needs asking", async () => {
    const port = { snapshot: async () => ({ check: () => "allow" }), allowAlways: async () => undefined };
    const { port: prompt, asked } = approvals("deny");

    const outcome = await requestMiniAppToolPermissions(
      { permissions: port, approvals: prompt },
      { pluginId: "pet", targets: [{ name: "a" }] },
    );

    expect(outcome.approvalRequired).toBe(false);
    expect(asked).toEqual([]);
  });
});
