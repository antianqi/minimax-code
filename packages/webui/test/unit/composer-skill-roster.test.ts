// The composer's skill pool is the runtime ROSTER.
//
// The runtime keeps two skill lists: the roster (`listRuntimeSkills`) — what a
// turn can load, carrying the plugin skills and the workspace's own skills —
// and the management catalogue (`listManageableSkills`) — the paged,
// user-facing list of what is installed. The slash palette shows the roster.
//
// The palette used to read the management catalogue, which is why it offered a
// fraction of the skills and none of the plugin ones. These cases pin the
// roster read: which action answers it, what scope it carries, what a row
// becomes, and when the answer is re-read.

import { describe, expect, it } from "vitest";
import { createWebuiComposerPluginCatalogue } from "../../src/client/features/plugins/application/composer-catalogue.js";
import { createWebuiPluginActions } from "../../src/client/features/plugins/contracts/plugin-actions.js";

interface RecordedCall {
  readonly action: string;
  readonly input?: Record<string, unknown>;
}

function catalogueWith(answer: unknown): {
  readonly catalogue: ReturnType<typeof createWebuiComposerPluginCatalogue>;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const catalogue = createWebuiComposerPluginCatalogue({
    actions: createWebuiPluginActions({
      pluginManagement: async (request) => {
        calls.push({
          action: request.action,
          ...(request.input ? { input: request.input } : {}),
        });
        return answer;
      },
    }),
  });
  return { catalogue, calls };
}

const ROSTER = {
  skills: [
    {
      name: "ask-matt",
      description: "Raw description",
      displayDescription: "The displayable description",
      sourceKind: "user",
      sourceType: 2,
      enabled: true,
    },
    {
      name: "lark:lark-doc",
      displayName: "lark:lark-doc",
      description: "Reads a Lark document",
      sourceKind: "plugin",
      enabled: true,
    },
  ],
};

describe("B07 request-specific retirement", () => {
  it.each(["plugins", "skills"])("an old %s rejection cannot evict its replacement", async (kind) => {
    const pending: Array<{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }> = [];
    const catalogue = createWebuiComposerPluginCatalogue({ actions: createWebuiPluginActions({
      pluginManagement: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    }) });
    const read = () => kind === "plugins" ? catalogue.installedPlugins() : catalogue.runtimeSkills({ sessionId: "A" });
    const invalidate = () => kind === "plugins" ? catalogue.invalidatePlugins() : catalogue.invalidateSkills();
    const first = read(); const rejected = expect(first).rejects.toThrow("old");
    invalidate(); const replacement = read();
    pending[0]!.reject(new Error("old")); await rejected;
    const joined = read(); expect(joined).toBe(replacement);
    expect(pending).toHaveLength(2);
    pending[1]!.resolve(kind === "plugins" ? { plugins: [{ name: "new" }] } : { skills: [{ name: "new" }] });
    expect((await replacement)[0]?.name).toBe("new");
    catalogue.dispose();
  });
  it.each(["plugins", "skills"])("an invalidated successful %s answer cannot reach consumers", async (kind) => {
    let resolve!: (value: unknown) => void;
    const catalogue = createWebuiComposerPluginCatalogue({ actions: createWebuiPluginActions({
      pluginManagement: () => new Promise((res) => { resolve = res; }),
    }) });
    const first = kind === "plugins" ? catalogue.installedPlugins() : catalogue.runtimeSkills();
    const rejected = expect(first).rejects.toThrow("已失效");
    if (kind === "plugins") catalogue.invalidatePlugins(); else catalogue.invalidateSkills();
    resolve(kind === "plugins" ? { plugins: [{ name: "old" }] } : { skills: [{ name: "old" }] });
    await rejected; catalogue.dispose();
  });
});

describe("the composer's skill pool", () => {
  it("is read from the runtime roster, scoped by the session", async () => {
    const { catalogue, calls } = catalogueWith(ROSTER);
    await catalogue.runtimeSkills({
      sessionId: "session-a",
      workspaceDir: "/workspace/project",
    });
    // The roster is the list a turn can load. The management catalogue is a
    // different list — paged, user-facing, and without the plugin skills — and
    // reading it here is what left the palette short.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe("listRuntimeSkills");
    expect(calls[0]?.input).toMatchObject({
      sessionId: "session-a",
      workspaceDir: "/workspace/project",
      // The plugin skills are part of the roster the agent can run.
      includePluginSkills: true,
    });
  });

  it("names no agent, because the runtime resolves the session's own", async () => {
    const { catalogue, calls } = catalogueWith(ROSTER);
    await catalogue.runtimeSkills({ sessionId: "session-a" });
    // Naming an agent could only contradict the session: the runtime resolves
    // the agent from the session itself, and a name it does not know (the
    // shell's placeholder for "no session" is one) makes the runtime answer
    // with an empty roster. The read must therefore stay silent about it.
    expect(calls[0]?.input).not.toHaveProperty("agentName");
  });

  it("maps a roster row into the summary the palette renders", async () => {
    const { catalogue } = catalogueWith(ROSTER);
    const skills = await catalogue.runtimeSkills({ sessionId: "session-a" });
    expect(skills).toEqual([
      {
        name: "ask-matt",
        // The displayable description wins over the raw one: that is the copy
        // the palette shows.
        description: "The displayable description",
        enabled: true,
        sourceKind: "user",
        sourceType: 2,
      },
      {
        name: "lark:lark-doc",
        displayName: "lark:lark-doc",
        description: "Reads a Lark document",
        enabled: true,
        sourceKind: "plugin",
      },
    ]);
  });

  it("does not offer a turned-off skill", async () => {
    const { catalogue } = catalogueWith({
      skills: [
        { name: "on", enabled: true },
        { name: "off", enabled: false },
      ],
    });
    const skills = await catalogue.runtimeSkills({ sessionId: "session-a" });
    expect(skills.map((skill) => skill.name)).toEqual(["on"]);
  });

  it("reads each scope once, and reads another scope when it comes", async () => {
    const { catalogue, calls } = catalogueWith(ROSTER);
    await catalogue.runtimeSkills({ sessionId: "session-a" });
    await catalogue.runtimeSkills({ sessionId: "session-a" });
    // The same scope is one answer, so the second reader joins the first read
    // instead of asking the runtime again.
    expect(calls).toHaveLength(1);
    // Another session is another roster: the workspace's own skills differ.
    await catalogue.runtimeSkills({ sessionId: "session-b" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toMatchObject({ sessionId: "session-b" });
  });

  it("drops every slot when a skill is written", async () => {
    const { catalogue, calls } = catalogueWith(ROSTER);
    await catalogue.runtimeSkills({ sessionId: "session-a" });
    await catalogue.runtimeSkills({ sessionId: "session-b" });
    expect(calls).toHaveLength(2);
    catalogue.invalidateSkills();
    await catalogue.runtimeSkills({ sessionId: "session-a" });
    await catalogue.runtimeSkills({ sessionId: "session-b" });
    // A skill write can change any session's roster, and a slot holds a
    // session's roster without naming the agent behind it, so nothing may be
    // served from the cache after one.
    expect(calls).toHaveLength(4);
  });
});
