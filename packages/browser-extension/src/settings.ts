// The extension's own settings, in `chrome.storage.local`.
//
// The bridge origin lives here because two surfaces need it and neither owns
// it alone: the service worker reads it when it starts, and the options page
// writes it. A key that both sides spell out separately is a key that can
// drift, so it is declared once.
//
// The origin is not a secret — it is the address of a host on this machine —
// so it is stored plainly and shown back. The *installation key* is the
// secret here, and it lives in `pairing.ts` instead.

import { webuiBrowserBridgeUrl } from "./protocol.js";

/** The `chrome.storage.local` key the bridge origin lives under. */
export const WEBUI_BROWSER_BRIDGE_ORIGIN_STORAGE_KEY = "webui.browserBridge.origin";

/**
 * The `chrome.storage.session` key the bridge's connection status lives under.
 *
 * Session storage, not local: the status describes this browser session, and
 * a stale "connected" from yesterday would be a lie.
 */
export const WEBUI_BROWSER_BRIDGE_STATUS_STORAGE_KEY = "webui.browserBridge.status";

/**
 * The `chrome.storage.session` key the last failure is parked under.
 *
 * Beside the status, so a surface that is waiting for an answer can read the
 * outcome and the reason in one place.
 */
export const WEBUI_BROWSER_BRIDGE_LAST_ERROR_STORAGE_KEY = "webui.browserBridge.lastError";

/**
 * The storage surface the settings are read from and written to.
 *
 * Narrow on purpose, so a test can stand in for `chrome.storage.local`.
 */
export interface WebuiBrowserBridgeSettingsArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * The origin this browser connects to, if one was configured.
 *
 * Absent is reported as `undefined` rather than replaced with a guessed
 * default port: the extension cannot learn the host's address by itself, and a
 * guessed port would quietly dial something else.
 */
export async function readWebuiBrowserBridgeOrigin(
  area: WebuiBrowserBridgeSettingsArea,
): Promise<string | undefined> {
  const stored = (await area.get(WEBUI_BROWSER_BRIDGE_ORIGIN_STORAGE_KEY))[
    WEBUI_BROWSER_BRIDGE_ORIGIN_STORAGE_KEY
  ];
  return typeof stored === "string" && stored.length > 0 ? stored : undefined;
}

/**
 * Stores the origin this browser connects to.
 *
 * The value is validated with the same function the client dials with, so an
 * origin written here is an origin that can actually be reached: a loopback
 * `http:` address with no path, because the client appends the bridge path
 * itself. A malformed URL is reported as something the person can act on
 * rather than as a parser's `Invalid URL`.
 *
 * An empty value clears the setting rather than storing an empty string: an
 * empty origin is an absent origin, and the worker reports that as "no
 * address configured" instead of dialling it.
 */
export async function writeWebuiBrowserBridgeOrigin(
  area: WebuiBrowserBridgeSettingsArea,
  origin: string,
): Promise<void> {
  const trimmed = origin.trim();
  if (trimmed.length === 0) {
    await area.remove(WEBUI_BROWSER_BRIDGE_ORIGIN_STORAGE_KEY);
    return;
  }
  try {
    // `webuiBrowserBridgeUrl` parses the origin and enforces the loopback
    // rule; this call only turns a malformed URL into a readable message.
    webuiBrowserBridgeUrl(trimmed);
  } catch (error) {
    throw new Error(
      error instanceof TypeError
        ? "that is not a URL — the address looks like http://127.0.0.1:8787"
        : error instanceof Error
          ? error.message
          : String(error),
    );
  }
  await area.set({ [WEBUI_BROWSER_BRIDGE_ORIGIN_STORAGE_KEY]: trimmed });
}
