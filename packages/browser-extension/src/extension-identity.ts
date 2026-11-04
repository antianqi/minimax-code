// This extension's own identity, and what a host has to be told about it.
//
// A Chrome/Edge extension knows its own id: `chrome.runtime.id`. The host
// does not, and the host is the party that decides whether an extension may
// connect — it admits an extension whose id is on its allowlist. So the id
// has to travel from the extension to the host.
//
// How it travels depends on which build this is:
//
//   * A **published** build carries the store's public key, so its id is
//     derived from that key and is the same on every machine. The released
//     WebUI package is built with that identity and admits it with no
//     configuration, so a person using the released product configures
//     nothing.
//   * A **local** build derives its id from the directory it was loaded from,
//     so the id is different on every machine and every path. A development
//     host has to be told which id to admit, and the only place that id
//     exists is here.
//
// Which is why this page shows the id and the one setting that carries it: the
// person who has to find an extension's id should not have to go and read it
// out of the browser's profile files.
//
// The functions here are pure. They take what they need and return what the
// page shows, so the only code that touches the extension APIs is the page's.

import type { WebuiBrowserBridgeBrowserName } from "./pairing.js";

/** Which kind of build this extension is. */
export type WebuiBrowserBridgeBuildKind = "published" | "local";

/**
 * The kind of build this is.
 *
 * A published build carries the store's public key in its manifest, and that
 * key is what fixes its identity. A local build carries no key, and its
 * identity comes from the path it was loaded from — which is why it cannot be
 * known in advance and has to be told to a host.
 */
export function webuiBrowserBridgeBuildKind(manifest: {
  readonly key?: unknown;
}): WebuiBrowserBridgeBuildKind {
  return typeof manifest.key === "string" && manifest.key.trim().length > 0
    ? "published"
    : "local";
}

/**
 * The variable a **development** host reads to admit this extension.
 *
 * The development host admits the extensions a developer names; the released
 * host admits the published extension it was built with. So this is the
 * variable a person can act on: it is what a local build needs, and what a
 * published build needs when it is pointed at a development host instead.
 */
export function webuiBrowserBridgeDevelopmentAllowlistVariable(
  browser: WebuiBrowserBridgeBrowserName,
): string {
  return browser === "edge"
    ? "MAVIS_BROWSER_EDGE_EXTENSION_IDS"
    : "MAVIS_BROWSER_CHROME_EXTENSION_IDS";
}

/**
 * The setting a development host needs, as one line a person can copy.
 *
 * The whole setting, not just the value: a host reads a list of ids from a
 * named variable, and a person who copies the id alone has to know which
 * variable it belongs in and which browser it belongs to.
 */
export function webuiBrowserBridgeDevelopmentAllowlistLine(
  browser: WebuiBrowserBridgeBrowserName,
  extensionId: string,
): string {
  return `${webuiBrowserBridgeDevelopmentAllowlistVariable(browser)}=${extensionId}`;
}

/**
 * Which browser this is.
 *
 * Both Edge and Chrome advertise themselves in the user agent, and the host
 * authorizes each surface separately, so the two are never treated as one.
 */
export function webuiBrowserBridgeBrowserName(
  userAgent: string,
): WebuiBrowserBridgeBrowserName {
  return userAgent.includes("Edg/") ? "edge" : "chrome";
}
