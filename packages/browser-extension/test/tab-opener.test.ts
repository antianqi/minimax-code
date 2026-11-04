// Opening a tab in the person's browser is the extension's own job: it holds
// the `tabs` permission, so `chrome.tabs.create` opens a page where
// `chrome.debugger` could not. This covers what the opener asks the browser
// for and what it reports back — not Chrome's behaviour on the other end.

import { describe, expect, it } from "vitest";

import { createWebuiBrowserBridgeTabOpener } from "../src/tab-opener.js";
import {
  createWebuiBrowserBridgeTargetRegistry,
  webuiBrowserBridgeTargetGenerationStore,
  type WebuiBrowserBridgeTabsApi,
} from "../src/targets.js";

interface CreatedTab {
  readonly url: string;
  readonly active: boolean;
}

interface FakeTabs extends WebuiBrowserBridgeTabsApi {
  readonly created: CreatedTab[];
  create(options: CreatedTab): Promise<{ id?: number; url?: string; title?: string }>;
}

/** A browser whose tabs the test holds: one tab, and the creations it was asked for. */
function fakeTabs(
  tabs: { id: number; url?: string; title?: string }[],
  create?: (options: CreatedTab) => Promise<{ id?: number; url?: string; title?: string }>,
): FakeTabs {
  const created: CreatedTab[] = [];
  return {
    created,
    async query() {
      return tabs;
    },
    async get(tabId) {
      return tabs.find((tab) => tab.id === tabId);
    },
    async create(options) {
      created.push(options);
      if (create) return await create(options);
      const tab = { id: 42, url: options.url, title: "Example" };
      tabs.push(tab);
      return tab;
    },
  };
}

async function registryFor(tabs: WebuiBrowserBridgeTabsApi) {
  const generations = webuiBrowserBridgeTargetGenerationStore({
    async get() {
      return {};
    },
    async set() {},
    async remove() {},
  });
  return createWebuiBrowserBridgeTargetRegistry({
    browserId: "browser-1",
    tabs,
    generations,
  });
}

describe("opening a tab in the person's browser", () => {
  it("opens the tab in the background, so the tab the person is looking at stays", async () => {
    const tabs = fakeTabs([{ id: 7, url: "https://example.com/", title: "Example" }]);
    const opener = createWebuiBrowserBridgeTabOpener({
      browserId: "browser-1",
      tabs,
      targets: await registryFor(tabs),
    });

    await opener.open("https://example.test/agent");

    // The person is looking at something; the Agent's page opens behind it.
    expect(tabs.created).toEqual([{ url: "https://example.test/agent", active: false }]);
  });

  it("reports the new tab's identity, so the host can address it", async () => {
    const tabs = fakeTabs([{ id: 7, url: "https://example.com/", title: "Example" }]);
    const opener = createWebuiBrowserBridgeTabOpener({
      browserId: "browser-1",
      tabs,
      targets: await registryFor(tabs),
    });

    const result = await opener.open("https://example.test/agent");

    expect(result.accepted).toBe(true);
    expect(result.target).toEqual({
      browserId: "browser-1",
      targetId: "tab-42",
      title: "Example",
      url: "https://example.test/agent",
      generation: 1,
    });
  });

  it("reports a browser that refuses to open the tab, rather than a tab", async () => {
    const tabs = fakeTabs([], async () => {
      throw new Error("cannot create a tab");
    });
    const opener = createWebuiBrowserBridgeTabOpener({
      browserId: "browser-1",
      tabs,
      targets: await registryFor(tabs),
    });

    const result = await opener.open("https://example.test/agent");

    // A refusal is a refusal: there is no target to report.
    expect(result.accepted).toBe(false);
    expect(result.target).toBeUndefined();
    expect(result.error).toContain("cannot create a tab");
  });
});
