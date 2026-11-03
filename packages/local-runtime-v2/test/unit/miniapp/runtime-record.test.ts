import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readMiniAppRuntimeRecord,
  removeMiniAppRuntimeRecord,
  stopMiniAppRuntimeElsewhere,
  writeMiniAppRuntimeRecord,
} from '../../../src/service/miniapp/process/node-runtime/runtime-record.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function pluginDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'miniapp runtime record '));
  roots.push(dir);
  return dir;
}

describe('the Mini App runtime record', () => {
  it('names the process that serves the Mini App, and forgets it when asked', async () => {
    const dir = await pluginDataDir();

    await writeMiniAppRuntimeRecord(dir, { pid: 4242, port: 50_123, startedAtMs: 1_700_000_000_000 });
    expect(await readMiniAppRuntimeRecord(dir)).toEqual({
      pid: 4242,
      port: 50_123,
      startedAtMs: 1_700_000_000_000,
    });

    await removeMiniAppRuntimeRecord(dir);
    expect(await readMiniAppRuntimeRecord(dir)).toBeUndefined();
  });

  it('says nothing about a record it cannot read', async () => {
    const dir = await pluginDataDir();
    await writeMiniAppRuntimeRecord(dir, { pid: 4242, port: 50_123, startedAtMs: 1 });

    // A truncated record is a record that says nothing, not one that says zero.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'runtime.json'), '{not json', 'utf8');
    expect(await readMiniAppRuntimeRecord(dir)).toBeUndefined();
  });
});

describe('stopping a Mini App another client is running', () => {
  it('ends the process the record names, once the guard proves the port', async () => {
    const dir = await pluginDataDir();
    await writeMiniAppRuntimeRecord(dir, { pid: 4242, port: 50_123, startedAtMs: 1 });
    const alive = new Set([4242]);
    const signals: string[] = [];

    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_123,
      probeGuard: async () => true,
      isProcessAlive: (pid) => alive.has(pid),
      kill: (pid, name) => {
        signals.push(name);
        if (name === 'SIGTERM') alive.delete(pid);
      },
      wait: async () => undefined,
    });

    expect(result).toEqual({ stopped: true });
    expect(signals).toEqual(['SIGTERM']);
    // The record outlived the process it named; it must not outlive that too.
    expect(await readMiniAppRuntimeRecord(dir)).toBeUndefined();
  });

  it('does not signal a process when the guard no longer answers on the port', async () => {
    const dir = await pluginDataDir();
    await writeMiniAppRuntimeRecord(dir, { pid: 4242, port: 50_123, startedAtMs: 1 });
    const signals: string[] = [];

    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_123,
      probeGuard: async () => false,
      isProcessAlive: () => true,
      kill: (pid, name) => {
        signals.push(name);
      },
      wait: async () => undefined,
    });

    expect(result).toEqual({ stopped: false, reason: 'guard-missing' });
    expect(signals).toEqual([]);
  });

  it('does not signal a process that is already gone, and clears its record', async () => {
    const dir = await pluginDataDir();
    await writeMiniAppRuntimeRecord(dir, { pid: 4242, port: 50_123, startedAtMs: 1 });
    const signals: string[] = [];

    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_123,
      probeGuard: async () => true,
      isProcessAlive: () => false,
      kill: (pid, name) => {
        signals.push(name);
      },
      wait: async () => undefined,
    });

    expect(result).toEqual({ stopped: false, reason: 'process-gone' });
    expect(signals).toEqual([]);
    expect(await readMiniAppRuntimeRecord(dir)).toBeUndefined();
  });

  it('ends the process that holds the port when no runtime ever recorded one', async () => {
    const dir = await pluginDataDir();
    const alive = new Set([777]);
    const signals: string[] = [];

    // A Mini App an older client started has no record. The port still names
    // the process, and the guard still proves that the port is a Mini App's.
    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_999,
      probeGuard: async () => true,
      readPortOwnerPid: async (port) => (port === 50_999 ? 777 : undefined),
      isProcessAlive: (pid) => alive.has(pid),
      kill: (pid, name) => {
        signals.push(name);
        if (name === 'SIGTERM') alive.delete(pid);
      },
      wait: async () => undefined,
    });

    expect(result).toEqual({ stopped: true });
    expect(signals).toEqual(['SIGTERM']);
  });

  it('reports that nothing of another client is running when the port does not answer', async () => {
    const dir = await pluginDataDir();
    const signals: string[] = [];

    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_999,
      probeGuard: async () => false,
      readPortOwnerPid: async () => 777,
      isProcessAlive: () => true,
      kill: (pid, name) => {
        signals.push(name);
      },
      wait: async () => undefined,
    });

    // Nothing is serving the port, so there is nothing of another client's to
    // stop, and no process may be signalled on the strength of a port alone.
    expect(result).toEqual({ stopped: false, reason: 'not-running' });
    expect(signals).toEqual([]);
  });

  it('reports that nothing of another client is running when the port names no process', async () => {
    const dir = await pluginDataDir();
    const signals: string[] = [];

    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_999,
      probeGuard: async () => true,
      readPortOwnerPid: async () => undefined,
      isProcessAlive: () => true,
      kill: (pid, name) => {
        signals.push(name);
      },
      wait: async () => undefined,
    });

    expect(result).toEqual({ stopped: false, reason: 'not-running' });
    expect(signals).toEqual([]);
  });

  it('reports that there is nothing to stop when no runtime ever recorded one', async () => {
    const dir = await pluginDataDir();

    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_123,
      probeGuard: async () => true,
      isProcessAlive: () => true,
      kill: () => undefined,
      wait: async () => undefined,
    });

    expect(result).toEqual({ stopped: false, reason: 'not-running' });
  });

  it('escalates to a kill when the process ignores the polite signal', async () => {
    const dir = await pluginDataDir();
    await writeMiniAppRuntimeRecord(dir, { pid: 4242, port: 50_123, startedAtMs: 1 });
    const alive = new Set([4242]);
    const signals: string[] = [];

    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_123,
      probeGuard: async () => true,
      isProcessAlive: (pid) => alive.has(pid),
      kill: (pid, name) => {
        signals.push(name);
        if (name === 'SIGKILL') alive.delete(pid);
      },
      wait: async () => undefined,
      graceMs: 1,
      settleMs: 1,
    });

    expect(result).toEqual({ stopped: true });
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('says so when the process refuses to leave', async () => {
    const dir = await pluginDataDir();
    await writeMiniAppRuntimeRecord(dir, { pid: 4242, port: 50_123, startedAtMs: 1 });

    const result = await stopMiniAppRuntimeElsewhere({
      pluginDataDir: dir,
      fallbackPort: 50_123,
      probeGuard: async () => true,
      isProcessAlive: () => true,
      kill: () => undefined,
      wait: async () => undefined,
      graceMs: 1,
      settleMs: 1,
    });

    expect(result).toEqual({ stopped: false, reason: 'stop-failed' });
    // A process that would not leave keeps its record: the next attempt is the
    // one that has to find it again.
    expect(await readMiniAppRuntimeRecord(dir)).toBeDefined();
  });
});
