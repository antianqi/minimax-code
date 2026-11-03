// The connector half of a page's tool list: provider switch, inventory, and calls.
//
// One seam: the source adapter over the host connector gateway, driven against a
// scripted gateway. What it proves is that the providers a person left on are the ones
// a page sees, that a call reaches the gateway with the handle the inventory issued,
// and that a name from a stale listing is re-resolved once instead of failing. What it
// does not cover: the gateway itself, the provider switches (the permission panel owns
// them; this adapter is handed the answer), and the naming a page sees — `connector__…`
// is composed in `tool-sources.ts`.

import { describe, expect, it } from "vitest";

import { createMiniAppConnectorToolSource } from "../../../src/service/miniapp/tool-source-connector.js";

const CALLER = { kind: "host-process" as const, pluginId: "pet", processGeneration: "gen-1" };

/** Every provider: the page channel lists what the account granted. */
const allProviders = (): readonly string[] => ["github", "linear"];

function gateway() {
  const listed: Array<{ providerAllowlist: readonly string[] | 'all' }> = [];
  const called: Array<{ handle: string; arguments: unknown }> = [];
  const inventory = [
    {
      handle: "handle-github-issues",
      provider: "github",
      providerToolName: "list_issues",
      runtimeToolName: "github_list_issues",
      description: "列出 issue",
      inputSchemaJson: "{}",
    },
    {
      handle: "handle-linear-issues",
      provider: "linear",
      providerToolName: "list_issues",
      runtimeToolName: "linear_list_issues",
      description: "列出 issue",
      inputSchemaJson: "{}",
    },
  ];
  let partial = false;
  return {
    listed,
    called,
    setPartial: (value: boolean) => {
      partial = value;
    },
    port: {
      list: async (input: { providerAllowlist: readonly string[] | 'all' }) => {
        listed.push({ providerAllowlist: input.providerAllowlist });
        const admits = (provider: string): boolean =>
          input.providerAllowlist === 'all' || input.providerAllowlist.includes(provider);
        return {
          tools: inventory.filter((tool) => admits(tool.provider)),
          providerFailures: [],
          partial,
        };
      },
      call: async (input: { handle: string; arguments: unknown }) => {
        called.push({ handle: input.handle, arguments: input.arguments });
        return { outcome: "completed" as const, content: [{ type: "text", text: "ok" }] };
      },
    },
  };
}

describe("the connector tools a page sees", () => {
  it("lists the tools of the providers it was given, under their provider", async () => {
    const fake = gateway();
    const source = createMiniAppConnectorToolSource({
      gateway: fake.port,
      caller: CALLER,
      providerAllowlist: ["github"],
    });

    expect(await source.list()).toEqual([
      { provider: "github", name: "list_issues", description: "列出 issue" },
    ]);
    expect(fake.listed).toEqual([{ providerAllowlist: ["github"] }]);
  });

  it("asks for every connected provider by default, as the shipped client does", async () => {
    // The account's own Connector grants are the only provider filter on this channel:
    // `hostConnectorAccess` and the `connector:<provider>` switches govern the subprocess
    // channel, not this one.
    const fake = gateway();
    const source = createMiniAppConnectorToolSource({ gateway: fake.port, caller: CALLER });

    expect((await source.list()).map((tool) => tool.provider)).toEqual(["github", "linear"]);
    expect(fake.listed).toEqual([{ providerAllowlist: "all" }]);
  });

  it("lists what it got when the inventory is partial", async () => {
    // A provider that failed to answer is a failure the gateway reports, not a reason
    // to hide the providers that did answer.
    const fake = gateway();
    fake.setPartial(true);
    const source = createMiniAppConnectorToolSource({
      gateway: fake.port,
      caller: CALLER,
      providerAllowlist: ["github"],
    });

    expect(await source.list()).toHaveLength(1);
  });
});

describe("a connector call from a page", () => {
  it("reaches the gateway with the handle the inventory issued", async () => {
    const fake = gateway();
    const source = createMiniAppConnectorToolSource({
      gateway: fake.port,
      caller: CALLER,
      providerAllowlist: allProviders(),
    });
    await source.list();

    await source.call({ provider: "linear", name: "list_issues", arguments: { limit: 3 } });

    expect(fake.called).toEqual([{ handle: "handle-linear-issues", arguments: { limit: 3 } }]);
  });

  it("resolves a name it has not listed yet, once, instead of failing", async () => {
    const fake = gateway();
    const source = createMiniAppConnectorToolSource({
      gateway: fake.port,
      caller: CALLER,
      providerAllowlist: ["github"],
    });

    await source.call({ provider: "github", name: "list_issues", arguments: {} });

    expect(fake.listed).toEqual([{ providerAllowlist: ["github"] }]);
    expect(fake.called).toEqual([{ handle: "handle-github-issues", arguments: {} }]);
  });

  it("refuses a tool no provider offers", async () => {
    const fake = gateway();
    const source = createMiniAppConnectorToolSource({
      gateway: fake.port,
      caller: CALLER,
      providerAllowlist: ["github"],
    });

    await expect(
      source.call({ provider: "github", name: "absent_tool", arguments: {} }),
    ).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });
    expect(fake.called).toEqual([]);
  });

});
