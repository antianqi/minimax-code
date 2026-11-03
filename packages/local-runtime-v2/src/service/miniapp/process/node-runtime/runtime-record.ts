import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { MiniAppForeignStopResult } from '../../contracts.js';

/**
 * Which process is serving a Mini App's loopback endpoint right now.
 *
 * The owner lease proves who holds a Mini App. This record proves which process
 * answers on its port. A client that does not own the Mini App cannot stop it
 * through its owner, but it can stop the process itself, and that needs the pid
 * from somewhere the owner wrote.
 *
 * The runner writes the record after it has bound the port and installed the
 * guard, so the record's presence is a promise that the guard is listening on
 * the recorded port. A record left behind by a process that died is stale, and
 * the reader proves it is stale rather than trusting it.
 */
export interface MiniAppRuntimeRecord {
  readonly pid: number;
  readonly port: number;
  readonly startedAtMs: number;
}

/** The record's file name, beside the owner lease in the plugin's own data directory. */
const RUNTIME_RECORD_FILE = 'runtime.json';

export interface StopMiniAppRuntimeElsewhereInput {
  readonly pluginDataDir: string;
  /** The port the Mini App serves on when no runtime record names one. */
  readonly fallbackPort: number;
  /** True when a Mini App guard answers on the port, so a Mini App owns it. */
  readonly probeGuard: (port: number) => Promise<boolean>;
  /**
   * The process listening on the port, when the platform can name one.
   *
   * A Mini App started by a client that predates the runtime record has no
   * record to read, and the port is the only thing left that names it.
   */
  readonly readPortOwnerPid?: (port: number) => Promise<number | undefined>;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
  readonly wait: (ms: number) => Promise<void>;
  /** How long a terminated process may take to leave before it is killed outright. */
  readonly graceMs?: number;
  /** How long the kill itself may take to settle. */
  readonly settleMs?: number;
}

/** Records which process serves this Mini App, so another client can stop it. */
export async function writeMiniAppRuntimeRecord(
  pluginDataDir: string,
  record: MiniAppRuntimeRecord,
): Promise<void> {
  await writeFile(
    path.join(pluginDataDir, RUNTIME_RECORD_FILE),
    `${JSON.stringify(record)}\n`,
    'utf8',
  );
}

/** The recorded process, or nothing when no Mini App ever recorded one here. */
export async function readMiniAppRuntimeRecord(
  pluginDataDir: string,
): Promise<MiniAppRuntimeRecord | undefined> {
  try {
    const raw = JSON.parse(
      await readFile(path.join(pluginDataDir, RUNTIME_RECORD_FILE), 'utf8'),
    ) as unknown;
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as MiniAppRuntimeRecord).pid === 'number' &&
      typeof (raw as MiniAppRuntimeRecord).port === 'number' &&
      Number.isSafeInteger((raw as MiniAppRuntimeRecord).pid) &&
      (raw as MiniAppRuntimeRecord).pid > 0 &&
      Number.isSafeInteger((raw as MiniAppRuntimeRecord).port)
    ) {
      return raw as MiniAppRuntimeRecord;
    }
  } catch {
    // An absent or unreadable record says nothing about a running process.
  }
  return undefined;
}

/** Removes the record. A missing record is already the wanted state. */
export async function removeMiniAppRuntimeRecord(pluginDataDir: string): Promise<void> {
  await rm(path.join(pluginDataDir, RUNTIME_RECORD_FILE), { force: true });
}

/**
 * Stops a Mini App this client does not own, by terminating the process that
 * answers on its port.
 *
 * Three facts have to agree before a process is signalled: something names a
 * process, that process is still alive, and the Mini App guard answers on the
 * port. The guard is what makes the kill safe — it proves the port belongs to a
 * Mini App rather than to whatever inherited the number after the original
 * process died — and the name is what says which process to kill. The name is
 * the runtime record when there is one, and the process listening on the port
 * when there is not, which is the case for a Mini App an older client started.
 *
 * The client that owned the Mini App keeps its own bookkeeping; this only ends
 * the process, and that client's next read sees the process gone.
 */
export async function stopMiniAppRuntimeElsewhere(
  input: StopMiniAppRuntimeElsewhereInput,
): Promise<MiniAppForeignStopResult> {
  const record = await readMiniAppRuntimeRecord(input.pluginDataDir);
  const port = record?.port ?? input.fallbackPort;
  if (!(await input.probeGuard(port))) {
    // A recorded Mini App whose port no longer answers is a port something
    // else took, and the record is not a licence to signal whatever holds it
    // now. With no record there is nothing of another client's running here.
    return {
      stopped: false,
      reason: record ? 'guard-missing' : 'not-running',
    };
  }
  const pid = record?.pid ?? (await input.readPortOwnerPid?.(port));
  if (pid === undefined) return { stopped: false, reason: 'not-running' };
  if (!input.isProcessAlive(pid)) {
    await removeMiniAppRuntimeRecord(input.pluginDataDir);
    return { stopped: false, reason: 'process-gone' };
  }
  const graceMs = input.graceMs ?? 2_000;
  const settleMs = input.settleMs ?? 4_000;
  signal(input, pid, 'SIGTERM');
  if (await waitForExit(input, pid, graceMs)) {
    await removeMiniAppRuntimeRecord(input.pluginDataDir);
    return { stopped: true };
  }
  signal(input, pid, 'SIGKILL');
  if (!(await waitForExit(input, pid, settleMs))) {
    return { stopped: false, reason: 'stop-failed' };
  }
  await removeMiniAppRuntimeRecord(input.pluginDataDir);
  return { stopped: true };
}

function signal(
  input: StopMiniAppRuntimeElsewhereInput,
  pid: number,
  name: NodeJS.Signals,
): void {
  try {
    input.kill(pid, name);
  } catch {
    // The process may have left between the liveness check and the signal; the
    // exit wait below is what decides the outcome.
  }
}

async function waitForExit(
  input: StopMiniAppRuntimeElsewhereInput,
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    if (!input.isProcessAlive(pid)) return true;
    const interval = Math.min(25, timeoutMs - elapsed);
    await input.wait(interval);
    elapsed += interval;
  }
  return !input.isProcessAlive(pid);
}
