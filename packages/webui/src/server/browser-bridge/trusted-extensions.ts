// The extension identities this host has learned to trust.
//
// A development host does not ask the person who runs it to name an
// extension's id. An unpacked build's id is derived from the folder it was
// loaded from, so it differs on every machine and every path, and a name
// the person has to go and look up is a name they will get wrong — or a
// name the product should not need at all.
//
// So the host learns the id from the extension itself, but only after the
// extension has proved possession of the surface's **installation key**.
// That key is the one secret a local process cannot hold, and the person
// hands it to an extension deliberately, by pasting it into the extension's
// own options page. An identity enters this file only behind that proof.
//
// What is in the file is not a secret — an extension id is public — but it
// is not public either: it records which extensions this machine has
// authorised, so the file is written the way the rest of the host's state
// is written: owner-only, atomically, and treated as absent when it cannot
// be read.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { WebuiBridgeBrowserSurface } from "../../shared/contracts/browser.js";

/** The file a host keeps its learned identities in, under the data directory. */
export function trustedExtensionsFile(dataDir: string): string {
  return join(dataDir, "browser-bridge", "trusted-extensions.json");
}

/**
 * Whether a string has the shape of a Chrome extension id.
 *
 * The same shape the bridge's origin parser accepts: 32 letters from `a` to
 * `p`. An id that does not have it could never match an origin, so it is
 * refused here rather than carried into the file.
 */
export function isExtensionId(value: unknown): value is string {
  return typeof value === "string" && /^[a-p]{32}$/u.test(value);
}

/**
 * The extension identities a host trusts, by surface.
 *
 * The trusted identities are the ones the host has *proved*, not the ones it
 * was configured with. The configured ones live in the allowlist the bridge
 * reads from its environment; this store is the other half.
 */
export interface TrustedExtensionStore {
  /** The ids trusted on one surface. */
  ids(surface: WebuiBridgeBrowserSurface): ReadonlySet<string>;
  /**
   * Record an id as trusted on one surface.
   *
   * Returns whether the id was recorded: an id that is not the shape of an
   * extension id is refused, and an id that is already trusted is not
   * written again.
   */
  trust(surface: WebuiBridgeBrowserSurface, extensionId: string): boolean;
  /** Forget an id on one surface. Returns whether there was one to forget. */
  forget(surface: WebuiBridgeBrowserSurface, extensionId: string): boolean;
}

/**
 * A store that keeps its identities in memory only.
 *
 * Used by a host with nowhere to persist, and by tests. The identities are
 * forgotten when the process ends, which for a development host means the
 * extension proves the installation key again — no worse than the first
 * time, and no secret is lost.
 */
export function createInMemoryTrustedExtensionStore(): TrustedExtensionStore {
  const bySurface = new Map<WebuiBridgeBrowserSurface, Set<string>>();
  const setFor = (surface: WebuiBridgeBrowserSurface): Set<string> => {
    const existing = bySurface.get(surface);
    if (existing) return existing;
    const created = new Set<string>();
    bySurface.set(surface, created);
    return created;
  };
  return {
    ids(surface) {
      return new Set(bySurface.get(surface) ?? []);
    },
    trust(surface, extensionId) {
      if (!isExtensionId(extensionId)) return false;
      const ids = setFor(surface);
      if (ids.has(extensionId)) return false;
      ids.add(extensionId);
      return true;
    },
    forget(surface, extensionId) {
      return setFor(surface).delete(extensionId);
    },
  };
}

/**
 * A store that keeps its identities in one JSON file.
 *
 * The file holds the ids per surface:
 *
 *   { "edge": ["mdbfmgllfnkmfambfjjnfchmhkphiggk"], "chrome": [] }
 *
 * The order inside a surface is the order the ids were trusted in, so the last
 * one is the extension the host learned most recently. That matters because a
 * machine can hold more than one build of the same extension — each unpacked
 * build has its own id — and the host has to be able to name the one the
 * person is actually using. The order is not sorted: a sorted list would say
 * nothing about recency.
 *
 * It is written atomically — a temporary file and a rename — so a crash in
 * the middle of a write cannot leave a half-written file that reads as
 * "this machine trusts nothing", or worse, as a set of ids nobody proved.
 * A file that cannot be read is treated as absent: the host then learns the
 * identities again from the extensions that prove the installation key.
 */
export function createFileTrustedExtensionStore(options: {
  readonly file: string;
}): TrustedExtensionStore {
  const bySurface = new Map<WebuiBridgeBrowserSurface, Set<string>>();
  const readFromDisk = (): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(options.file, "utf8"));
    } catch {
      // Absent or unreadable: the host starts with nothing trusted, which
      // means the extensions prove themselves again. Nothing is lost, because
      // what is lost is a convenience and not a secret.
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    for (const [surface, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (surface !== "edge" && surface !== "chrome") continue;
      if (!Array.isArray(value)) continue;
      const ids = value.filter((entry): entry is string => isExtensionId(entry));
      if (ids.length > 0) bySurface.set(surface, new Set(ids));
    }
  };
  readFromDisk();

  const writeToDisk = (): void => {
    const payload: Record<string, string[]> = {};
    for (const [surface, ids] of bySurface) {
      if (ids.size === 0) continue;
      // The trust order, not the alphabetical one: the last id is the
      // extension the host learned most recently.
      payload[surface] = [...ids];
    }
    try {
      mkdirSync(dirname(options.file), { recursive: true, mode: 0o700 });
      const temporary = `${options.file}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, options.file);
    } catch {
      // A host that cannot write its state still works: the identities live
      // in memory for this process, and the extensions prove themselves
      // again after a restart.
    }
  };

  const setFor = (surface: WebuiBridgeBrowserSurface): Set<string> => {
    const existing = bySurface.get(surface);
    if (existing) return existing;
    const created = new Set<string>();
    bySurface.set(surface, created);
    return created;
  };
  return {
    ids(surface) {
      return new Set(bySurface.get(surface) ?? []);
    },
    trust(surface, extensionId) {
      if (!isExtensionId(extensionId)) return false;
      const ids = setFor(surface);
      if (ids.has(extensionId)) return false;
      ids.add(extensionId);
      writeToDisk();
      return true;
    },
    forget(surface, extensionId) {
      const removed = setFor(surface).delete(extensionId);
      if (removed) writeToDisk();
      return removed;
    },
  };
}
