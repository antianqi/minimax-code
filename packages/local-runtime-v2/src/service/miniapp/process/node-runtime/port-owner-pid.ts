import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Which process is listening on a local port.
 *
 * The runtime record names the process that serves a Mini App, but a Mini App
 * that a client started before the record existed — an orphan left behind by a
 * client that is gone — has no record. The port still names the process: the
 * kernel knows which socket is listening and which process holds it.
 *
 * The answer is only a name. What makes it safe to act on is the caller: the
 * Mini App guard has to answer on that very port before the process is
 * signalled, so the process this returns is the one serving a Mini App rather
 * than whatever else could be listening.
 */
export interface PortOwnerPidInput {
  /** The loopback port a Mini App serves on. */
  readonly port: number;
  /** The platform to answer for; the running one by default. */
  readonly platform?: string;
  /** The platform's own answer, when it has one. */
  readonly readPortOwnerPid?: (port: number) => Promise<number | undefined>;
}

/**
 * The process listening on a port, when the platform can name one.
 *
 * A port that nothing holds has no owner, and a platform that does not list
 * its sockets does not answer either. Both are "nothing to stop" rather than
 * a failure: the caller decides what to do with the absence.
 */
export async function readPortOwnerPid(
  input: PortOwnerPidInput,
): Promise<number | undefined> {
  if (input.readPortOwnerPid) return input.readPortOwnerPid(input.port);
  const platform = input.platform ?? process.platform;
  if (platform === 'linux') return readLinuxPortOwnerPid(input.port);
  if (platform === 'darwin') return readDarwinPortOwnerPid(input.port);
  return undefined;
}

/**
 * The socket inodes listening on a port, read from the kernel's own tables.
 *
 * The tables are read as text because that is what they are: one row per
 * socket, with the local address and port in hexadecimal, a state, and the
 * inode that names the socket. Only a listening socket on the wanted port is
 * of any use here.
 */
export function parseListeningSocketInodes(
  content: string,
  port: number,
): readonly number[] {
  const inodes: number[] = [];
  for (const line of content.split('\n')) {
    const fields = line.trim().split(/\s+/u);
    // The header row and every malformed row are skipped rather than guessed
    // at: a row that does not parse names no socket.
    if (fields.length < 10) continue;
    if (!/^\d+:$/u.test(fields[0] ?? '')) continue;
    const local = fields[1] ?? '';
    const separator = local.lastIndexOf(':');
    if (separator < 0) continue;
    const localPort = Number.parseInt(local.slice(separator + 1), 16);
    if (!Number.isSafeInteger(localPort) || localPort !== port) continue;
    // \"0A\" is TCP_LISTEN.
    if (fields[3] !== '0A') continue;
    const inode = Number.parseInt(fields[9] ?? '', 10);
    if (Number.isSafeInteger(inode) && inode > 0) inodes.push(inode);
  }
  return inodes;
}

/**
 * The process holding a socket, named by the socket it holds.
 *
 * Every process lists its open descriptors, and a socket descriptor points at
 * the socket's inode. The process whose descriptors hold the wanted inode is
 * the process the socket belongs to.
 */
export function parseProcessBySocketInode(
  entries: readonly { readonly pid: number; readonly links: readonly string[] }[],
  inode: number,
): number | undefined {
  const target = `socket:[${inode}]`;
  for (const entry of entries) {
    if (entry.links.some((link) => link === target)) return entry.pid;
  }
  return undefined;
}

/** The pids a listing tool named for a port. */
export function parseLsofPids(stdout: string): readonly number[] {
  const pids: number[] = [];
  for (const line of stdout.split('\n')) {
    const pid = Number.parseInt(line.trim(), 10);
    if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

async function readLinuxPortOwnerPid(port: number): Promise<number | undefined> {
  const inodes: number[] = [];
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let content: string;
    try {
      content = await readFile(table, 'utf8');
    } catch {
      // The table is missing or unreadable: this answer is not available.
      continue;
    }
    inodes.push(...parseListeningSocketInodes(content, port));
  }
  if (inodes.length === 0) return undefined;
  const entries = await readLinuxProcessDescriptors();
  for (const inode of inodes) {
    const pid = parseProcessBySocketInode(entries, inode);
    if (pid !== undefined) return pid;
  }
  return undefined;
}

async function readLinuxProcessDescriptors(): Promise<
  { readonly pid: number; readonly links: readonly string[] }[]
> {
  let processes: string[];
  try {
    processes = await readdir('/proc');
  } catch {
    return [];
  }
  const entries: { pid: number; links: string[] }[] = [];
  for (const process of processes) {
    if (!/^\d+$/u.test(process)) continue;
    const pid = Number.parseInt(process, 10);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    let descriptors: string[];
    try {
      descriptors = await readdir(path.join('/proc', process, 'fd'));
    } catch {
      // Another user's process is not readable here, and a process that left
      // between the two listings is gone. Neither is a reason to stop.
      continue;
    }
    const links: string[] = [];
    for (const descriptor of descriptors) {
      try {
        links.push(
          await readlink(path.join('/proc', process, 'fd', descriptor)),
        );
      } catch {
        // The descriptor closed between the listing and the read.
      }
    }
    entries.push({ pid, links });
  }
  return entries;
}

async function readDarwinPortOwnerPid(port: number): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      { timeout: 5_000 },
    );
    return parseLsofPids(stdout)[0];
  } catch {
    // The listing tool is missing or refused: this answer is not available.
    return undefined;
  }
}
