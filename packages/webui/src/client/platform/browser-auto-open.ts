// Whether a page the Agent opens brings the browser panel up with it.
//
// This opens the right-side browser panel when the agent operates a page.
// It is a client preference — the runtime's browser-use service has no
// such setting — so it lives in browser storage beside this client's other
// remembered choices.
//
// It is off by default.

import { getWebuiBrowserStorage } from "./storage.js";

/** Storage key. Versioned like the other remembered choices. */
export const WEBUI_BROWSER_AUTO_OPEN_STORAGE_KEY = "webui-browser-auto-open";

/** False unless the reader turned it on. */
export function readWebuiBrowserAutoOpen(): boolean {
  try {
    return getWebuiBrowserStorage()?.getItem(WEBUI_BROWSER_AUTO_OPEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Remember the choice. A storage that refuses is not fatal. */
export function writeWebuiBrowserAutoOpen(enabled: boolean): void {
  try {
    getWebuiBrowserStorage()?.setItem(WEBUI_BROWSER_AUTO_OPEN_STORAGE_KEY, String(enabled));
  } catch {
    // The next read falls back to off; nothing on screen depends on the write.
  }
}
