// The remote terminal.
//
// One session is one `ssh -tt` running on a local pseudo-terminal:
//
//   * `-tt` makes OpenSSH allocate a pseudo-terminal on the far side, so the remote shell is a
//     real interactive shell rather than a pipe.
//   * The local side is a real pseudo-terminal too, and that is what carries the size: OpenSSH
//     reads the window size of its own terminal and sends the change to the remote one. A local
//     pipe would leave the remote shell at a fixed 80x24 and every resize would be a lie.
//
// The output is buffered, because the browser attaches to a session that already exists: the
// person who opens the terminal sees what the remote side printed before they typed anything.
import { randomUUID } from "node:crypto";

import { buildRemoteTerminalCommand, buildSshArgs } from "./command.js";
import type { SshAuthentication } from "./authentication.js";
import type { SshConnectionRepository } from "./connection-repository.js";
import { SshRuntimeError } from "./errors.js";
import type { SshProjectRepository } from "./project-repository.js";
import type { SshTerminalProcess, SshTransport } from "./transport.js";
import type { SshTerminalSessionRecord } from "./types.js";
import { isSafeSshAlias } from "./validators.js";

interface TerminalSession {
  readonly id: string;
  readonly alias: string;
  readonly process: SshTerminalProcess;
  status: SshTerminalSessionRecord["status"];
  error?: string;
  /** The recent output, replayed to whoever attaches later. */
  readonly buffer: string[];
  readonly listeners: Set<(data: string) => void>;
  readonly closeListeners: Set<() => void>;
  closed: boolean;
}

const MAX_BUFFERED_CHUNKS = 2_000;

export interface SshTerminalOpenOutcome {
  readonly session: SshTerminalSessionRecord;
  readonly error?: string;
}

export interface SshTerminalService {
  open(request: {
    readonly alias: string;
    readonly path?: string;
    readonly cols?: number;
    readonly rows?: number;
  }): Promise<SshTerminalOpenOutcome>;
  write(terminalId: string, data: string): boolean;
  resize(terminalId: string, cols: number, rows: number): boolean;
  close(terminalId: string): boolean;
  /** The session's output: the buffered part first, then what arrives. */
  watch(terminalId: string, signal?: AbortSignal): AsyncIterable<{ readonly data: string }>;
  dispose(): void;
}

export interface SshTerminalServiceOptions {
  readonly connections: SshConnectionRepository;
  readonly projects: SshProjectRepository;
  readonly transport: SshTransport;
  /** Which authentication the session's `ssh` invocation uses. */
  readonly authentication: SshAuthentication;
}

export function createSshTerminalService(options: SshTerminalServiceOptions): SshTerminalService {
  const sessions = new Map<string, TerminalSession>();

  return {
    async open(request) {
      const alias = request.alias?.trim() ?? "";
      if (!isSafeSshAlias(alias)) {
        return {
          session: { terminalId: "", alias, status: "failed", error: "invalid_input" },
        };
      }
      const connection = await options.connections.get(alias);
      if (!connection) {
        return {
          session: { terminalId: "", alias, status: "failed", error: "没有找到这个 SSH 主机。" },
        };
      }
      if (!connection.enabled) {
        return {
          session: { terminalId: "", alias, status: "failed", error: "这个主机已停用。" },
        };
      }
      // The folder the session starts in: the one that was asked for, else the project rooted on
      // this host, else the remote home directory the shell opens in anyway.
      const path = request.path?.trim() || (await firstProjectPath(options.projects, alias));
      const mode = options.authentication.modeFor(alias);
      if (mode.kind === "unavailable") {
        return {
          session: {
            terminalId: "",
            alias,
            status: "failed",
            error: `密码登录不可用：${mode.reason}`,
          },
        };
      }
      const args = buildSshArgs(connection.endpoint, { password: mode.kind === "password", tty: true });
      const remoteCommand = buildRemoteTerminalCommand(path);
      const env = mode.kind === "password" ? mode.env : undefined;

      const terminalId = `ssh-terminal-${randomUUID()}`;
      let child: SshTerminalProcess;
      try {
        child = options.transport.spawnTerminal([...args, remoteCommand], {
          cols: request.cols ?? 80,
          rows: request.rows ?? 24,
          ...(env ? { env } : {}),
        });
      } catch (error) {
        return {
          session: {
            terminalId,
            alias,
            status: "failed",
            error: error instanceof Error ? error.message : "无法启动远程终端。",
          },
        };
      }

      const session: TerminalSession = {
        id: terminalId,
        alias,
        process: child,
        status: "starting",
        buffer: [],
        listeners: new Set(),
        closeListeners: new Set(),
        closed: false,
      };
      sessions.set(terminalId, session);

      child.onData((data) => {
        if (session.status === "starting") session.status = "running";
        session.buffer.push(data);
        if (session.buffer.length > MAX_BUFFERED_CHUNKS) session.buffer.shift();
        for (const listener of session.listeners) listener(data);
      });
      child.onExit(() => {
        session.closed = true;
        session.status = "closed";
        for (const listener of session.closeListeners) listener();
      });

      return { session: { terminalId, alias, status: session.status } };
    },

    write(terminalId, data) {
      const session = sessions.get(terminalId);
      if (!session || session.closed) return false;
      if (typeof data !== "string" || data.length === 0) return false;
      session.process.write(data);
      return true;
    },

    resize(terminalId, cols, rows) {
      const session = sessions.get(terminalId);
      if (!session || session.closed) return false;
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return false;
      session.process.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)));
      return true;
    },

    close(terminalId) {
      const session = sessions.get(terminalId);
      if (!session) return false;
      if (!session.closed) {
        session.process.kill();
        session.closed = true;
        session.status = "closed";
        for (const listener of session.closeListeners) listener();
      }
      sessions.delete(terminalId);
      return true;
    },

    watch(terminalId, signal) {
      const session = sessions.get(terminalId);
      if (!session) {
        throw new SshRuntimeError("terminal_not_found", "没有找到这个远程终端。");
      }
      return watchSession(session, signal);
    },

    dispose() {
      for (const session of sessions.values()) {
        if (!session.closed) {
          try {
            session.process.kill();
          } catch {
            // A session that is already gone needs no killing.
          }
          session.closed = true;
          session.status = "closed";
        }
        // A watcher parked on this session is released here too: the process is gone, so no
        // close event will come from it.
        for (const listener of session.closeListeners) listener();
      }
      sessions.clear();
    },
  };
}

/** The output of one session: the buffered part first, then whatever arrives. */
async function* watchSession(
  session: TerminalSession,
  signal?: AbortSignal,
): AsyncGenerator<{ readonly data: string }> {
  // One mailbox for the whole life of the watch, and it is filled in the same turn it is opened.
  //
  // The replay used to be a snapshot yielded out before the listener existed: a consumer that
  // paused after the first replayed chunk lost everything the child wrote meanwhile — those bytes
  // went into the session buffer for whoever attached next, never into this stream. Copying the
  // buffer into the mailbox and subscribing before the first yield closes that gap, so every byte
  // is in exactly one place when the reader comes back.
  const queue: string[] = [...session.buffer];
  let wake: (() => void) | undefined;
  let cancelled = signal?.aborted ?? false;
  const resume = (): void => {
    const pending = wake;
    wake = undefined;
    pending?.();
  };
  const onData = (data: string): void => {
    queue.push(data);
    resume();
  };
  const onClose = (): void => {
    resume();
  };
  // A parked iterator has nothing to wake it while the remote side is quiet, so the caller's
  // signal wakes it itself. `iterator.return()` cannot do this: it does not interrupt an
  // unresolved `next()`, which is why a disconnected reader used to leave its listener behind
  // until the next chunk or the shell's exit — possibly never.
  const onAbort = (): void => {
    cancelled = true;
    resume();
  };
  session.listeners.add(onData);
  session.closeListeners.add(onClose);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (!cancelled) {
      const data = queue.shift();
      if (data !== undefined) {
        yield { data };
        continue;
      }
      if (session.closed) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    session.listeners.delete(onData);
    session.closeListeners.delete(onClose);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** The path of the first project rooted on one host. */
async function firstProjectPath(
  projects: SshProjectRepository,
  alias: string,
): Promise<string | undefined> {
  const records = await projects.list();
  return records.find((project) => project.alias === alias)?.path;
}
