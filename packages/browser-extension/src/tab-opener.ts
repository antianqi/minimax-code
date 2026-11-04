// Opening a tab in the person's browser.
//
// `chrome.debugger` cannot create a page — that is why the bridge used to
// refuse `open_tab` on the external surfaces. The extension is more than its
// debugger: it holds the `tabs` permission, so it can open a tab itself.
//
// The tab opens in the background. The person is looking at their own tab, and
// a page the Agent opened must not take their window away from them.

import type { WebuiBrowserBridgeTarget } from "./protocol.js";
import {
  WEBUI_BROWSER_BRIDGE_FIRST_GENERATION,
  webuiBrowserBridgeTargetId,
  type WebuiBrowserBridgeTargetRegistry,
  type WebuiBrowserBridgeTabsApi,
} from "./targets.js";

/** The part of `chrome.tabs` that creates a page. */
export interface WebuiBrowserBridgeTabCreator {
  create(createProperties: {
    readonly url: string;
    readonly active: boolean;
  }): Promise<{
    readonly id?: number;
    readonly title?: string;
    readonly url?: string;
  }>;
}

/** What one open attempt came to. */
export interface WebuiBrowserBridgeTabOpenResult {
  readonly accepted: boolean;
  readonly target?: WebuiBrowserBridgeTarget;
  readonly error?: string;
}

export interface WebuiBrowserBridgeTabOpener {
  /** Opens a tab for the given url, in the background. */
  open(url: string): Promise<WebuiBrowserBridgeTabOpenResult>;
}

export interface WebuiBrowserBridgeTabOpenerOptions {
  readonly browserId: string;
  readonly tabs: WebuiBrowserBridgeTabsApi & WebuiBrowserBridgeTabCreator;
  readonly targets: WebuiBrowserBridgeTargetRegistry;
}

/**
 * Creates the opener.
 *
 * The new tab's identity comes from the browser's own answer, and its
 * generation from the registry — a tab that has never navigated is at the
 * first generation, so a host that addresses it immediately is addressing the
 * page that was just created.
 */
export function createWebuiBrowserBridgeTabOpener(
  options: WebuiBrowserBridgeTabOpenerOptions,
): WebuiBrowserBridgeTabOpener {
  return {
    async open(url) {
      let tab: { readonly id?: number; readonly title?: string; readonly url?: string };
      try {
        tab = await options.tabs.create({ url, active: false });
      } catch (cause) {
        // A browser that refused is reported as a refusal. There is no tab to
        // report, and a host that was handed one would act on a page that does
        // not exist.
        return {
          accepted: false,
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
      if (tab.id === undefined) {
        return { accepted: false, error: "the browser created a tab without an id" };
      }
      const targetId = webuiBrowserBridgeTargetId(tab.id);
      const resolved = await options.targets.lookup(targetId);
      return {
        accepted: true,
        target: {
          browserId: options.browserId,
          targetId,
          title: tab.title ?? "",
          url: tab.url ?? url,
          generation: resolved?.generation ?? WEBUI_BROWSER_BRIDGE_FIRST_GENERATION,
        },
      };
    },
  };
}
