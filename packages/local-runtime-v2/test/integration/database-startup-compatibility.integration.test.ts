import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDatabaseBackupIfPending } from '../../src/infra/db/backup.js';
import { DatabaseClient, loadSqlite3Constructor } from '../../src/infra/db/client.js';
import { initializeDatabase } from '../../src/infra/db/initialize.js';
import { assertDatabaseSchemaConsistent } from '../../src/infra/db/schema-consistency.js';
import { SqliteCronRunRepository } from '../../src/service/cron/adapters/run.repository.js';
import { SqliteCronDefinitionRepository } from '../../src/service/cron/adapters/definition.repository.js';

const clients: DatabaseClient[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0).reverse()) client.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function openDatabase() {
  const dataDir = await mkdtemp(join(tmpdir(), 'database-startup-'));
  directories.push(dataDir);
  const database = new DatabaseClient({ dataDir });
  clients.push(database);
  await initializeDatabase({ database, dataDir });
  return { database, dataDir };
}

function dropOwnerColumn(database: DatabaseClient) {
  database.rawDb.exec('ALTER TABLE local_runtime_v2_cron_runs DROP COLUMN owner_instance_id');
}

describe('shared database startup compatibility', () => {
  it.each([false, true])(
    'repairs a missing owner column with migration 54 recorded: %s',
    async (recorded) => {
      const { database, dataDir } = await openDatabase();
      new SqliteCronDefinitionRepository(database.db).insert({
        cronId: 'kept-cron',
        schedulerId: 'kept-scheduler',
        agentName: 'general',
        name: 'Keep this task',
        prompt: 'Synthetic task',
        sessionTarget: { mode: 'new' },
        createdAtMs: 1,
      });
      const runs = new SqliteCronRunRepository(database.db, () => 'kept-run');
      const pendingRun = runs.insertPendingManualForDefinition('kept-cron', 2);
      dropOwnerColumn(database);
      if (!recorded)
        database.rawDb.exec('DELETE FROM local_runtime_v2_schema_migrations WHERE version=54');
      const history = database.rawDb
        .prepare('SELECT * FROM local_runtime_v2_schema_migrations ORDER BY version')
        .all();
      database.rawDb.exec(
        "CREATE TABLE compatibility_sentinel (value TEXT); INSERT INTO compatibility_sentinel VALUES ('keep')",
      );
      const result = await initializeDatabase({ database, dataDir });
      expect(result.backup.created).toBe(true);
      expect(runs.listPending()).toEqual([pendingRun]);
      expect(database.rawDb.prepare('SELECT value FROM compatibility_sentinel').get()).toEqual({
        value: 'keep',
      });
      if (recorded) {
        expect(
          database.rawDb
            .prepare('SELECT * FROM local_runtime_v2_schema_migrations ORDER BY version')
            .all(),
        ).toEqual(history);
      }
      if (!result.backup.created) throw new Error('expected a pre-repair backup');
      // Inspect the real pre-repair backup through an independent read-only SQLite connection.
      const Database = loadSqlite3Constructor();
      const backup = new Database(join(dataDir, 'v2/sqlite/backups', result.backup.fileName), {
        readonly: true,
      });
      try {
        expect(backup.prepare('PRAGMA table_info(local_runtime_v2_cron_runs)').all()).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: 'owner_instance_id' })]),
        );
      } finally {
        backup.close();
      }
      const next = await initializeDatabase({ database, dataDir });
      expect(next.backup.created).toBe(false);
    },
  );

  it('rejects a missing owner column during schema validation', async () => {
    const { database } = await openDatabase();
    dropOwnerColumn(database);
    expect(() => assertDatabaseSchemaConsistent(database.rawDb)).toThrow(/owner_instance_id/);
  });

  it('allows two connections to repair the same shared profile without duplicate ALTERs', async () => {
    const { database, dataDir } = await openDatabase();
    dropOwnerColumn(database);
    const history = database.rawDb
      .prepare('SELECT * FROM local_runtime_v2_schema_migrations')
      .all();
    const peer = new DatabaseClient({ dataDir });
    clients.push(peer);
    const results = await Promise.all([
      initializeDatabase({ database, dataDir }),
      initializeDatabase({ database: peer, dataDir }),
    ]);
    expect(results.every((result) => result.backup.created)).toBe(true);
    expect(new SqliteCronRunRepository(database.db).listPending()).toEqual([]);
    expect(new SqliteCronRunRepository(peer.db).listPending()).toEqual([]);
    expect(
      database.rawDb.prepare('SELECT * FROM local_runtime_v2_schema_migrations').all(),
    ).toEqual(history);
  });

  it('boots the WebUI Cron service against a recorded migration with a missing column', async () => {
    const { database, dataDir } = await openDatabase();
    dropOwnerColumn(database);
    database.close();
    const readPending = vi.spyOn(SqliteCronRunRepository.prototype, 'listPending');
    const { createLocalRuntimeHostV2ForTest } = await import('../../src/runtime.js');
    const host = await createLocalRuntimeHostV2ForTest({
      dataDir,
      runtimeOwnerKind: 'webui',
      capabilities: { cliEmbedded: true },
      configGetter: () => ({ dataDir, provider: {} }),
      defaultWorkspaceDir: join(dataDir, 'workspace'),
      fetchImpl: async () => Response.json({ errorCode: 0, action: 1 }),
    });
    try {
      await host.ready;
      expect(readPending).toHaveBeenCalled();
    } finally {
      await host.apiHost.close();
    }
  }, 60_000);

  it('does not repair schema or change receipts if the required backup fails', async () => {
    const { database, dataDir } = await openDatabase();
    dropOwnerColumn(database);
    const history = database.rawDb
      .prepare('SELECT * FROM local_runtime_v2_schema_migrations')
      .all();
    vi.spyOn(database, 'backup').mockRejectedValue(new Error('synthetic disk failure'));
    await expect(initializeDatabase({ database, dataDir })).rejects.toThrow(/backup failed/i);
    expect(
      database.rawDb.prepare('SELECT * FROM local_runtime_v2_schema_migrations').all(),
    ).toEqual(history);
    expect(() => new SqliteCronRunRepository(database.db).listPending()).toThrow(
      /owner_instance_id/,
    );
  });

  it('finishes a consistent backup while a second WAL connection keeps writing', async () => {
    const { database, dataDir } = await openDatabase();
    database.rawDb.exec(
      'CREATE TABLE payload (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, body BLOB)',
    );
    database.rawDb.transaction(() => {
      const insert = database.rawDb.prepare('INSERT INTO payload(body) VALUES (zeroblob(4096))');
      for (let i = 0; i < 1024; i++) insert.run();
    })();
    const writer = new DatabaseClient({ dataDir });
    clients.push(writer);
    const update = writer.rawDb.prepare('UPDATE payload SET revision=revision+1 WHERE id=1');
    const backup = database.rawDb.backup.bind(database.rawDb);
    let steps = 0;
    let previous = Infinity;
    let regressions = 0;
    vi.spyOn(database.rawDb, 'backup').mockImplementation((file, options) =>
      backup(file, {
        progress(progress) {
          steps++;
          if (progress.remainingPages > previous) regressions++;
          previous = progress.remainingPages;
          if (steps > 80) throw new Error('backup repeatedly restarted under concurrent writes');
          update.run();
          return options?.progress?.(progress);
        },
      }),
    );
    const result = await createDatabaseBackupIfPending({ database, dataDir, pending: true });
    expect(result.created).toBe(true);
    expect(steps).toBeGreaterThan(2);
    expect(regressions).toBe(0);
    expect(writer.rawDb.prepare('SELECT revision FROM payload WHERE id=1').get()).toEqual({
      revision: steps,
    });
    if (!result.created) throw new Error('expected backup');
    const Database = loadSqlite3Constructor();
    const snapshot = new Database(join(dataDir, 'v2/sqlite/backups', result.fileName), {
      readonly: true,
    });
    try {
      expect(snapshot.prepare('SELECT revision FROM payload WHERE id=1').get()).toEqual({
        revision: 0,
      });
      expect(snapshot.prepare('SELECT count(*) AS count FROM payload').get()).toEqual({
        count: 1024,
      });
    } finally {
      snapshot.close();
    }
    // The snapshot read transaction must be released before migrations write.
    database.rawDb.exec('CREATE TABLE after_backup (value TEXT)');
  });

  it('aborts a stalled copy, releases its read transaction and removes the partial backup', async () => {
    const { database, dataDir } = await openDatabase();
    const before = await readdir(join(dataDir, 'v2/sqlite/backups'));
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const nativeBackup = database.rawDb.backup.bind(database.rawDb);
    let steps = 0;
    vi.spyOn(database.rawDb, 'backup').mockImplementation((file, options) =>
      nativeBackup(file, {
        progress(progress) {
          if (++steps > 3) throw new Error('missing backup cancellation');
          if (steps > 1) clock.mockReturnValue(61_000);
          options?.progress?.(progress);
          // Hold the real native copy at zero pages; only the clock and transfer rate are synthetic.
          return 0;
        },
      }),
    );
    await expect(
      createDatabaseBackupIfPending({ database, dataDir, pending: true }),
    ).rejects.toMatchObject({
      code: 'LOCAL_RUNTIME_V2_DATABASE_BACKUP_FAILED',
      cause: expect.objectContaining({ message: expect.stringMatching(/no progress/i) }),
    });
    expect(await readdir(join(dataDir, 'v2/sqlite/backups'))).toEqual(before);
    database.rawDb.exec('CREATE TABLE after_failed_backup (value TEXT)');
  });

  it('bounds total copy time even while individual batches still make progress', async () => {
    const { database, dataDir } = await openDatabase();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.spyOn(database.rawDb, 'backup').mockImplementation(async (_file, options) => {
      // This test exercises the watchdog policy; the previous test covers native cancellation.
      for (let step = 0; step <= 61; step++) {
        clock.mockReturnValue(step * 10_000);
        options?.progress?.({ totalPages: 100, remainingPages: 100 - step });
      }
      return { totalPages: 100, remainingPages: 39 };
    });
    await expect(
      createDatabaseBackupIfPending({ database, dataDir, pending: true }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/exceeded 10 minutes/) }),
    });
    database.rawDb.exec('CREATE TABLE after_deadline (value TEXT)');
  });
});
