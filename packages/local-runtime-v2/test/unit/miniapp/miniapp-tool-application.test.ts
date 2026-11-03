// What a page's tool request means at the application boundary.
//
// One seam: `createProcessLocalMiniAppApplication(...).callTool(...)`. What it proves:
// a package the Host cannot find is refused before the channel is asked; a Host that
// composed no channel says the capability is absent rather than answering an empty
// listing; and a request the Host can serve is forwarded as it arrived, identity
// included — the page never supplies that. What it does not cover: the channel itself
// (its own tests) and the wire that carries the answer to a page.

import { describe, expect, it } from "vitest";

import { createProcessLocalMiniAppApplication } from "../../../src/application/session/process-local-miniapp-application.js";
import type { MiniAppStatus, MiniAppSupervisor } from "../../../src/service/miniapp/index.js";
import type { MiniAppToolSessions } from "../../../src/service/miniapp/tool-sessions.js";
import type { MiniAppPluginControl } from "../../../src/service/plugin-system/index.js";

type Supervisor = Pick<
  MiniAppSupervisor,
  "inspect" | "launchCredential" | "ownerClient" | "stopElsewhere"
>;

const plugins = {
  listAvailableMiniApps: async () => [{ pluginId: "demo", source: "official" as const }],
} as unknown as MiniAppPluginControl;

function supervisorOf(active?: { readonly processGeneration: string }): Supervisor {
  return {
    inspect: () =>
      [
        {
          pluginId: "demo",
          phase: active ? "active" : "stopped",
          ...(active
            ? { active: { pluginId: "demo", processGeneration: active.processGeneration } }
            : {}),
          retiringGenerationIds: [],
          leaseCount: 0,
          logs: [],
        },
      ] as unknown as MiniAppStatus[],
    launchCredential: () => undefined,
    ownerClient: async () => undefined,
    stopElsewhere: async () => ({ stopped: true }),
  } as unknown as Supervisor;
}

const supervisor = supervisorOf();

function harness(options: {
  readonly withChannel: boolean;
  readonly supervisor?: Supervisor;
}) {
  const asked: unknown[] = [];
  const channel: MiniAppToolSessions = {
    run: async (input) => {
      asked.push(input);
      return { tools: [] };
    },
  };
  return {
    application: createProcessLocalMiniAppApplication(
      plugins,
      options.supervisor ?? supervisor,
      options.withChannel ? channel : undefined,
    ),
    asked,
  };
}

describe("a page's tool request at the application boundary", () => {
  it("forwards what the Host can serve, with the identity the Host resolved", async () => {
    const { application, asked } = harness({ withChannel: true });

    expect(
      await application?.callTool({
        pluginId: "demo",
        processGeneration: "gen-1",
        method: "call",
        name: "mcp__files__read",
        arguments: { path: "a" },
      }),
    ).toEqual({ tools: [] });
    expect(asked).toEqual([
      {
        pluginId: "demo",
        processGeneration: "gen-1",
        method: "call",
        name: "mcp__files__read",
        arguments: { path: "a" },
      },
    ]);
  });

  it("resolves the generation from what is running when the request names none", async () => {
    const { application, asked } = harness({
      withChannel: true,
      supervisor: supervisorOf({ processGeneration: "gen-live" }),
    });

    await application?.callTool({ pluginId: "demo", method: "list" });

    // The page cannot know a generation, so the Host fills it from the process it is
    // framing — the same identity the connector gateway registered.
    expect(asked).toEqual([{ pluginId: "demo", processGeneration: "gen-live", method: "list" }]);
  });

  it("refuses a package the Host does not serve", async () => {
    const { application, asked } = harness({ withChannel: true });

    await expect(application?.callTool({ pluginId: "gone", method: "list" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(asked).toEqual([]);
  });

  it("says the channel is absent when the Host composed none", async () => {
    const { application } = harness({ withChannel: false });

    // The catalogue still answers: the refusal belongs to the tool request, not to
    // "this Host has no Mini App capability at all".
    await expect(application?.callTool({ pluginId: "demo", method: "list" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});
