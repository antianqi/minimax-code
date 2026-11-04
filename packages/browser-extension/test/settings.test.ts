// The bridge origin: the one setting the person enters by hand.
//
// The rules here are the ones the client dials with, and they are enforced
// on write rather than at connect time: an origin that is stored but cannot
// be reached produces a connection failure nobody can act on, while a
// rejected one says exactly what is wrong with it.

import { describe, expect, it } from "vitest";

import {
  readWebuiBrowserBridgeOrigin,
  writeWebuiBrowserBridgeOrigin,
  WEBUI_BROWSER_BRIDGE_ORIGIN_STORAGE_KEY,
  type WebuiBrowserBridgeSettingsArea,
} from "../src/settings.js";

/** A stand-in for `chrome.storage.local`. */
function createFakeArea(): WebuiBrowserBridgeSettingsArea & {
  readonly items: Map<string, unknown>;
} {
  const items = new Map<string, unknown>();
  return {
    items,
    async get(key) {
      return items.has(key) ? { [key]: items.get(key) } : {};
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) items.set(key, value);
    },
    async remove(key) {
      items.delete(key);
    },
  };
}

describe("the bridge origin setting", () => {
  it("reports an absent origin as undefined rather than guessing one", async () => {
    const area = createFakeArea();
    expect(await readWebuiBrowserBridgeOrigin(area)).toBeUndefined();
  });

  it("stores a loopback origin and reads it back", async () => {
    const area = createFakeArea();
    await writeWebuiBrowserBridgeOrigin(area, "http://127.0.0.1:8787");
    expect(await readWebuiBrowserBridgeOrigin(area)).toBe("http://127.0.0.1:8787");
  });

  it("accepts localhost as well as the loopback address", async () => {
    const area = createFakeArea();
    await writeWebuiBrowserBridgeOrigin(area, "http://localhost:8787");
    expect(await readWebuiBrowserBridgeOrigin(area)).toBe("http://localhost:8787");
  });

  it("trims the value it stores", async () => {
    const area = createFakeArea();
    await writeWebuiBrowserBridgeOrigin(area, "  http://127.0.0.1:8787  ");
    expect(await readWebuiBrowserBridgeOrigin(area)).toBe("http://127.0.0.1:8787");
  });

  it("refuses an origin that is not a loopback address", async () => {
    const area = createFakeArea();
    await expect(
      writeWebuiBrowserBridgeOrigin(area, "http://example.com"),
    ).rejects.toThrow(/loopback/u);
    expect(await readWebuiBrowserBridgeOrigin(area)).toBeUndefined();
  });

  it("refuses an origin that is not plain http", async () => {
    const area = createFakeArea();
    await expect(
      writeWebuiBrowserBridgeOrigin(area, "https://127.0.0.1:8787"),
    ).rejects.toThrow(/protocol/u);
  });

  it("reports a malformed address as something the person can act on", async () => {
    const area = createFakeArea();
    await expect(
      writeWebuiBrowserBridgeOrigin(area, "not an address"),
    ).rejects.toThrow(/not a URL/u);
  });

  it("clears the setting rather than storing an empty origin", async () => {
    const area = createFakeArea();
    await writeWebuiBrowserBridgeOrigin(area, "http://127.0.0.1:8787");
    await writeWebuiBrowserBridgeOrigin(area, "   ");
    expect(await readWebuiBrowserBridgeOrigin(area)).toBeUndefined();
    expect(area.items.has(WEBUI_BROWSER_BRIDGE_ORIGIN_STORAGE_KEY)).toBe(false);
  });
});
