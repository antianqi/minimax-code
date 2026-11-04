// The identities a host has learned from the extensions that proved them.
//
// The store is what makes a development host work without configuration: an
// unpacked build's id is derived from the folder it was loaded from, so it
// differs on every machine, and the host learns it from the extension that
// proved the installation key.

import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createFileTrustedExtensionStore,
  createInMemoryTrustedExtensionStore,
  isExtensionId,
  trustedExtensionsFile,
} from "../../src/server/browser-bridge/trusted-extensions.js";

const EDGE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab";
const CHROME_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("the trusted extension identities", () => {
  it("holds the ids it is given and forgets the ones it is told to forget", () => {
    const store = createInMemoryTrustedExtensionStore();
    expect(store.ids("edge").size).toBe(0);
    expect(store.trust("edge", EDGE_ID)).toBe(true);
    expect(store.ids("edge").has(EDGE_ID)).toBe(true);
    // A surface is its own list: an Edge identity is not a Chrome identity.
    expect(store.ids("chrome").has(EDGE_ID)).toBe(false);
    // Trusting the same id again is not a change.
    expect(store.trust("edge", EDGE_ID)).toBe(false);
    expect(store.forget("edge", EDGE_ID)).toBe(true);
    expect(store.ids("edge").size).toBe(0);
    expect(store.forget("edge", EDGE_ID)).toBe(false);
  });

  it("refuses an id that no browser could ever have", () => {
    const store = createInMemoryTrustedExtensionStore();
    expect(store.trust("edge", "not-an-extension-id")).toBe(false);
    // 32 letters, but not from `a` to `p`: no browser would ever issue it.
    expect(store.trust("edge", "z".repeat(32))).toBe(false);
    expect(store.trust("edge", "a".repeat(31))).toBe(false);
    expect(store.ids("edge").size).toBe(0);
  });

  it("recognises the shape a browser gives an extension id", () => {
    expect(isExtensionId(EDGE_ID)).toBe(true);
    expect(isExtensionId("z".repeat(32))).toBe(false);
    expect(isExtensionId("a".repeat(31))).toBe(false);
    expect(isExtensionId(undefined)).toBe(false);
  });
});

describe("the trusted extension identities on disk", () => {
  it("survives a restart of the host", () => {
    const directory = mkdtempSync(join(tmpdir(), "webui-trusted-"));
    const file = trustedExtensionsFile(directory);
    const store = createFileTrustedExtensionStore({ file });
    store.trust("edge", EDGE_ID);
    store.trust("chrome", CHROME_ID);

    // A host that starts again reads what the last one learned.
    const reloaded = createFileTrustedExtensionStore({ file });
    expect(reloaded.ids("edge").has(EDGE_ID)).toBe(true);
    expect(reloaded.ids("chrome").has(CHROME_ID)).toBe(true);
  });

  it("is written where the host keeps its state, and only the owner may read it", () => {
    const directory = mkdtempSync(join(tmpdir(), "webui-trusted-"));
    const file = trustedExtensionsFile(directory);
    const store = createFileTrustedExtensionStore({ file });
    store.trust("edge", EDGE_ID);

    expect(file).toBe(join(directory, "browser-bridge", "trusted-extensions.json"));
    const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, string[]>;
    expect(written.edge).toEqual([EDGE_ID]);
    // The file says which extensions this machine authorised. It is not a
    // secret, but it is not everybody's business either.
    expect(statSync(file).mode & 0o077).toBe(0);
  });

  it("treats a file it cannot read as no identities at all", () => {
    const directory = mkdtempSync(join(tmpdir(), "webui-trusted-"));
    const file = trustedExtensionsFile(directory);
    const store = createFileTrustedExtensionStore({ file });
    store.trust("edge", EDGE_ID);

    // A file that was cut short by a crash reads as nothing, not as a
    // half-set of identities.
    writeFileSync(file, "{\"edge\": [\"" + EDGE_ID.slice(0, 8), "utf8");
    const reloaded = createFileTrustedExtensionStore({ file });
    expect(reloaded.ids("edge").size).toBe(0);
  });

  it("drops the entries in it that are not extension ids", () => {
    const directory = mkdtempSync(join(tmpdir(), "webui-trusted-"));
    const file = trustedExtensionsFile(directory);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ edge: [EDGE_ID, "nonsense"], chrome: "not-a-list" }),
      "utf8",
    );
    const reloaded = createFileTrustedExtensionStore({ file });
    expect(reloaded.ids("edge").has(EDGE_ID)).toBe(true);
    expect(reloaded.ids("edge").size).toBe(1);
    expect(reloaded.ids("chrome").size).toBe(0);
  });
});
