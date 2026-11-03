// The Mini App permission switches as they are stored.
//
// One seam: the repository's public read/write over a real database, created by the
// migrations this distribution ships. What it proves is the storage contract the
// runtime relies on — a missing row means "on", so only a refusal is written, and a
// decision follows the half of the inventory it was made for. What it does not
// cover: which ids a package may declare (the manifest reader's job) and whether a
// switch is consulted before a call (the connector and gateway tests).

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DatabaseClient } from "../../src/infra/db/client.js";
import { initializeDatabase } from "../../src/infra/db/initialize.js";
import { SqlitePluginRepository } from "../../src/service/plugin-system/plugin/runtime/repository.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function setup() {
  const dataDir = await mkdtemp(join(tmpdir(), "miniapp-permission-"));
  const client = new DatabaseClient({ dataDir });
  await initializeDatabase({ database: client, dataDir });
  cleanup.push(
    () => rm(dataDir, { recursive: true, force: true }),
    // Windows cannot unlink an open database; the handle closes first.
    () => client.close(),
  );
  return new SqlitePluginRepository(client.db, () => 1);
}

describe("the stored Mini App permission switches", () => {
  it("treats a permission nobody decided about as on", async () => {
    const repository = await setup();

    expect(repository.listDisabledMiniAppPermissions("minimax-pet", "official").size).toBe(0);

    repository.setMiniAppPermissionEnabled("minimax-pet", "official", "device:microphone", false);
    expect([...repository.listDisabledMiniAppPermissions("minimax-pet", "official")]).toEqual([
      "device:microphone",
    ]);

    // Turning it back on is a decision too, and it is not reported as a refusal.
    repository.setMiniAppPermissionEnabled("minimax-pet", "official", "device:microphone", true);
    expect(repository.listDisabledMiniAppPermissions("minimax-pet", "official").size).toBe(0);
  });

  it("keeps one package's decisions out of another's", async () => {
    const repository = await setup();

    repository.setMiniAppPermissionEnabled("minimax-pet", "official", "device:microphone", false);
    repository.setMiniAppPermissionEnabled("other-app", "official", "tool:call", false);

    expect([...repository.listDisabledMiniAppPermissions("minimax-pet", "official")]).toEqual([
      "device:microphone",
    ]);
    expect([...repository.listDisabledMiniAppPermissions("other-app", "official")]).toEqual([
      "tool:call",
    ]);
  });

  it("keeps a decision with the half of the inventory it was made for", async () => {
    const repository = await setup();

    // The same id can be served by an official package and a local one. A refusal
    // made against the official one must not silence the local copy.
    repository.setMiniAppPermissionEnabled("minimax-pet", "official", "device:microphone", false);

    expect(repository.listDisabledMiniAppPermissions("minimax-pet", "local").size).toBe(0);
    expect(repository.listDisabledMiniAppPermissions("minimax-pet", "official").size).toBe(1);
  });

  it("forgets one package's decisions and leaves the rest", async () => {
    const repository = await setup();

    repository.setMiniAppPermissionEnabled("minimax-pet", "official", "device:microphone", false);
    repository.setMiniAppPermissionEnabled("minimax-pet", "local", "tool:call", false);
    repository.setMiniAppPermissionEnabled("other-app", "official", "tool:call", false);

    repository.deleteMiniAppPermissions("minimax-pet", "official");

    expect(repository.listDisabledMiniAppPermissions("minimax-pet", "official").size).toBe(0);
    // The other half and the other package keep their decisions: an uninstall names
    // one package in one half, never a sweep.
    expect(repository.listDisabledMiniAppPermissions("minimax-pet", "local").size).toBe(1);
    expect(repository.listDisabledMiniAppPermissions("other-app", "official").size).toBe(1);
  });
});
