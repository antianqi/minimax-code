// The composer's skill pool is the runtime ROSTER.
//
// The runtime keeps two skill lists: the roster (`listRuntimeSkills`) — what a
// turn can load, carrying the plugin skills and the workspace's own skills —
// and the management catalogue (`listManageableSkills`) — the paged,
// user-facing list of what is installed. The slash palette shows the roster,
// the way the Desktop palette does.
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

describe("the composer's skill pool", () => {
  it("is read from the runtime roster, scoped by agent and session", async () => {
    const { catalogue, calls } = catalogueWith(ROSTER);
    await catalogue.runtimeSkills({ agentName: "mavis", sessionId: "session-a" });
    // The roster is the list a turn can load. The management catalogue is a
    // different list — paged, user-facing, and without the plugin skills — and
    // reading it here is what left the palette short.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe("listRuntimeSkills");
    expect(calls[0]?.input).toMatchObject({
      agentName: "mavis",
      sessionId: "session-a",
      // The plugin skills are part of the roster the agent can run.
      includePluginSkills: true,
    });
  });

  it("maps a roster row into the summary the palette renders", async () => {
    const { catalogue } = catalogueWith(ROSTER);
    const skills = await catalogue.runtimeSkills({ agentName: "mavis" });
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
    const skills = await catalogue.runtimeSkills({ agentName: "mavis" });
    expect(skills.map((skill) => skill.name)).toEqual(["on"]);
  });

  it("reads each scope once, and reads another scope when it comes", async () => {
    const { catalogue, calls } = catalogueWith(ROSTER);
    await catalogue.runtimeSkills({ agentName: "mavis", sessionId: "session-a" });
    await catalogue.runtimeSkills({ agentName: "mavis", sessionId: "session-a" });
    // The same scope is one answer, so the second reader joins the first read
    // instead of asking the runtime again.
    expect(calls).toHaveLength(1);
    // Another session is another roster: the workspace's own skills differ.
    await catalogue.runtimeSkills({ agentName: "mavis", sessionId: "session-b" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toMatchObject({ sessionId: "session-b" });
  });

  it("drops the written agent's slots and keeps the other agents'", async () => {
    const { catalogue, calls } = catalogueWith(ROSTER);
    await catalogue.runtimeSkills({ agentName: "mavis" });
    await catalogue.runtimeSkills({ agentName: "worker" });
    expect(calls).toHaveLength(2);
    catalogue.invalidateSkills("mavis");
    await catalogue.runtimeSkills({ agentName: "mavis" });
    // The written agent's slot is stale; the other agent's slot still stands,
    // because a write for one agent says nothing about another's roster.
    expect(calls).toHaveLength(3);
    await catalogue.runtimeSkills({ agentName: "worker" });
    expect(calls).toHaveLength(3);
  });

  it("drops every slot when a write names no agent", async () => {
    const { catalogue, calls } = catalogueWith(ROSTER);
    await catalogue.runtimeSkills({ agentName: "mavis" });
    catalogue.invalidateSkills();
    await catalogue.runtimeSkills({ agentName: "mavis" });
    // A write that cannot be attributed to an agent may have changed the
    // default agent's roster, so nothing may be served from the cache.
    expect(calls).toHaveLength(2);
  });
});
