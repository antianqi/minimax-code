// The on-disk shape of the SSH runtime's own records, and the one way they are changed.
//
// Two files live under the runtime's data directory, one store per concern:
//
//   * `connections.json` — the saved hosts.
//   * `projects.json` — the projects rooted on them.
//
// Every document is `{ version, revision, <member> }`. Three rules decide what a caller sees,
// and they are stated here because both repositories must answer them the same way:
//
//   * **A document that cannot be read is not an empty document.** `readFile` failing with
//     `ENOENT` is the one case that means "nothing saved yet". Invalid JSON, a version this
//     build does not know, or a member that fails the codec's record validation is
//     `unusable`: the caller is told why, and no write may overwrite the file. The bytes on disk
//     are the last durable record of somebody's hosts; rebuilding it from an empty list is data
//     loss wearing a success face.
//   * **A change is a transaction, not a blind write.** `transact` takes the file's lock, reads
//     the document again under it, hands that state to the caller's change, and only then
//     commits. Two saves that started from the same snapshot cannot lose one another: the second
//     one sees the first one's commit.
//   * **The lock is cross-process.** `node_modules/.bin/webui` may be started twice against one
//     data directory (a second tab, a restarted service, a checkout run beside the packaged
//     app), and a promise map inside one process says nothing about the other. The lock is a
//     sibling `<file>.lock` directory managed by proper-lockfile, with heartbeat renewal and
//     stale-holder recovery. A live writer renews its lease while it writes.
//
// Writes are atomic: the new content goes to a sibling file first and is renamed over the old
// one, so a crash mid-write cannot leave a half-written store behind. Nothing here is a secret —
// the password is never written (see `credentials.ts`).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

import { SshRuntimeError } from "./errors.js";

/** The document version this build writes and accepts. */
export const SSH_STORE_VERSION = 1;

/** Why a document that exists could not be used. */
export type SshStoreUnusableReason = "unreadable" | "corrupt" | "unsupported_version" | "malformed";

/** What one read of a store answered. */
export type SshStoreRead<T> =
  | { readonly kind: "absent"; readonly revision: 0 }
  | {
      readonly kind: "unusable";
      readonly reason: SshStoreUnusableReason;
      readonly detail: string;
    }
  | { readonly kind: "usable"; readonly value: T; readonly revision: number };

/**
 * The change a caller supplies to a transaction.
 *
 * `commit` writes `value` as the store's next committed state; `keep` leaves the file alone
 * (a removal that matched nothing, a probe whose host changed under it).
 */
export type SshStoreChange<T, R> =
  | { readonly kind: "commit"; readonly value: T; readonly result: R }
  | { readonly kind: "keep"; readonly result: R };

/** How one concern's member is validated and projected. */
export interface SshStoreCodec<T> {
  /** The member the document keeps, e.g. `connections`. */
  readonly member: string;
  /**
   * Validate and project the committed member.
   *
   * A refusal names the first thing that did not hold, so the failure a person reads points at
   * the field rather than at "invalid data".
   */
  readonly read: (
    value: unknown,
  ) => { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };
}

/** One store file: reads answer what is there, transactions change it. */
export interface SshStore<T> {
  /** The last committed state. Takes no lock: a reader never blocks a writer. */
  read(): Promise<SshStoreRead<T>>;
  /**
   * Read the file under its lock, let `change` decide, and commit.
   *
   * An unusable document is refused before `change` runs: there is no "current state" to change
   * from, and writing anything would replace bytes this build cannot account for.
   */
  transact<R>(
    change: (current: SshStoreRead<T>) => SshStoreChange<T, R>,
  ): Promise<{ readonly revision: number; readonly result: R }>;
}

/** How long a transaction waits for the lock before giving up. */
const LOCK_TIMEOUT_MS = 10_000;
/** How long a lock file may stay behind before it is presumed abandoned. */
const LOCK_STALE_MS = 300_000;

/**
 * The failure an unusable store produces, in the words the browser may read.
 *
 * The detail names the file, never its absolute path: the browser is told which store could not
 * be read, not where this machine keeps its data directory.
 */
export function storeUnavailableError(
  filePath: string,
  read: { readonly reason: SshStoreUnusableReason; readonly detail: string },
): SshRuntimeError {
  const name = path.basename(filePath);
  const reason =
    read.reason === "unsupported_version"
      ? "版本不受支持"
      : read.reason === "corrupt"
        ? "内容已损坏"
        : read.reason === "malformed"
          ? "记录不完整"
          : "无法读取";
  return new SshRuntimeError(
    "storage_unavailable",
    `SSH 数据文件 ${name} ${reason}：${read.detail}。为保留原有数据，本次操作没有写入。`,
  );
}

/** One store file over one path. */
export function createSshStore<T>(filePath: string, codec: SshStoreCodec<T>): SshStore<T> {
  const lockPath = `${filePath}.lock`;

  const decode = async (): Promise<SshStoreRead<T>> => {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent", revision: 0 };
      return {
        kind: "unusable",
        reason: "unreadable",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        kind: "unusable",
        reason: "corrupt",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { kind: "unusable", reason: "malformed", detail: "顶层不是对象" };
    }
    const document = parsed as Record<string, unknown>;
    const version = document.version;
    if (typeof version !== "number") {
      return { kind: "unusable", reason: "malformed", detail: "缺少 version" };
    }
    if (version !== SSH_STORE_VERSION) {
      return {
        kind: "unusable",
        reason: "unsupported_version",
        detail: `文件版本 ${version}，本版本只接受 ${SSH_STORE_VERSION}`,
      };
    }
    const revision = document.revision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      return { kind: "unusable", reason: "malformed", detail: "缺少可用的 revision" };
    }
    const member = document[codec.member];
    if (!Array.isArray(member)) {
      return { kind: "unusable", reason: "malformed", detail: `${codec.member} 不是数组` };
    }
    const decoded = codec.read(member);
    if (!decoded.ok) {
      return { kind: "unusable", reason: "malformed", detail: decoded.detail };
    }
    return { kind: "usable", value: decoded.value, revision };
  };

  const commit = async (value: T, revision: number): Promise<void> => {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const document = {
      version: SSH_STORE_VERSION,
      revision,
      [codec.member]: value,
    };
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
      await rename(temporaryPath, filePath);
    } catch (error) {
      // A failed write must not leave an uncommitted document beside the real one.
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  return {
    read: decode,

    async transact<R>(change: (current: SshStoreRead<T>) => SshStoreChange<T, R>) {
      return serialize(filePath, async () => {
        await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
        let compromised: Error | undefined;
        const release = await lockfile.lock(filePath, {
          realpath: false,
          lockfilePath: lockPath,
          stale: LOCK_STALE_MS,
          update: 10_000,
          retries: { retries: LOCK_TIMEOUT_MS / 100, minTimeout: 100, maxTimeout: 100, factor: 1 },
          onCompromised: (error) => { compromised = error; },
        });
        try {
          const current = await decode();
          if (current.kind === "unusable") throw storeUnavailableError(filePath, current);
          const decision = change(current);
          if (decision.kind === "keep") {
            return { revision: current.kind === "usable" ? current.revision : 0, result: decision.result };
          }
          const validated = codec.read(decision.value);
          if (!validated.ok) throw storeUnavailableError(filePath, { reason: "malformed", detail: validated.detail });
          const revision = (current.kind === "usable" ? current.revision : 0) + 1;
          if (compromised) throw compromised;
          await commit(decision.value, revision);
          return { revision, result: decision.result };
        } finally {
          await release();
        }
      });
    },
  };
}

/**
 * Transactions on one file, in this process, in arrival order.
 *
 * The file lock is the cross-process guarantee; this queue is what keeps one process's own
 * writers from spending the lock's retry budget against each other. Both are needed: the queue
 * alone would state nothing about a second process, and the lock alone would turn a burst of
 * local writers into a spin loop.
 */
const serialQueues = new Map<string, Promise<void>>();

async function serialize<R>(key: string, task: () => Promise<R>): Promise<R> {
  const previous = serialQueues.get(key) ?? Promise.resolve();
  const settled = previous.then(
    () => undefined,
    () => undefined,
  );
  const run = settled.then(task);
  const tail = run.then(
      () => undefined,
      () => undefined,
    );
  serialQueues.set(key, tail);
  try { return await run; } finally {
    if (serialQueues.get(key) === tail) serialQueues.delete(key);
  }
}
