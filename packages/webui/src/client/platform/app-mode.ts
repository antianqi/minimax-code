// The application mode this client remembers.
//
// `coding` is the mode the product ships with: a session that keeps the
// technical detail a development task needs. `work` is the same agent with the
// engineering framing turned down. The *meaning* of the two belongs to the
// runtime — it resolves the mode to a session's prompts and to the capabilities
// it gates (`packages/local-runtime/src/runtime/app-mode.ts`) — so this module
// only remembers which one the reader chose, and hands it to session creation.
//
// The preference is a client preference, not a server setting: the Desktop keeps
// it in its own desktop config (`appModePreference`), and this client has no
// equivalent persisted store, so it lives in browser storage beside the other
// choices this client remembers (the no-project flag, the team-mode flag).

import { getWebuiBrowserStorage } from "./storage.js";

/** The two modes the runtime understands. */
export type WebuiAppMode = "coding" | "work";

/** What a session runs as until the reader chooses otherwise. */
export const WEBUI_APP_MODE_DEFAULT: WebuiAppMode = "coding";

/** Storage key. Versioned like the other remembered choices. */
export const WEBUI_APP_MODE_STORAGE_KEY = "mavis-app-mode";

/** One of the two modes, or the default for anything else. */
export function parseWebuiAppMode(value: unknown): WebuiAppMode {
  return value === "work" || value === "coding" ? value : WEBUI_APP_MODE_DEFAULT;
}

/** The remembered mode, or the default. */
export function readWebuiAppMode(): WebuiAppMode {
  try {
    return parseWebuiAppMode(getWebuiBrowserStorage()?.getItem(WEBUI_APP_MODE_STORAGE_KEY));
  } catch {
    return WEBUI_APP_MODE_DEFAULT;
  }
}

/** Remember a mode. A storage that refuses (private mode, quota) is not fatal. */
export function writeWebuiAppMode(mode: WebuiAppMode): void {
  try {
    getWebuiBrowserStorage()?.setItem(WEBUI_APP_MODE_STORAGE_KEY, mode);
  } catch {
    // The next read falls back to the default; nothing on screen depends on the
    // write having landed.
  }
}
