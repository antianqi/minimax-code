// The projects rooted on a saved SSH host.
//
// A project is a folder on a remote machine: which host it lives on, which path, and the name it
// is shown under. The store is separate from the host store, so removing a host can name the
// projects that went with it — the answer the browser shows after a removal.
//
// Like the host store, every change is a transaction over the file (see `storage.ts`), and an
// unreadable document is refused rather than treated as an empty list.
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SshRuntimeError } from "./errors.js";
import {
  createSshStore,
  storeUnavailableError,
  type SshStoreChange,
  type SshStoreRead,
} from "./storage.js";
import type { SshProjectRecord } from "./types.js";

interface StoredProject {
  readonly id: string;
  readonly alias: string;
  readonly path: string;
  readonly displayName: string;
}

export interface SshProjectRepository {
  list(): Promise<readonly SshProjectRecord[]>;
  get(id: string): Promise<SshProjectRecord | undefined>;
  save(record: {
    readonly id?: string;
    readonly alias: string;
    readonly path: string;
    readonly displayName: string;
  }): Promise<SshProjectRecord>;
  remove(id: string): Promise<boolean>;
  /** Remove every project rooted on one host and name the ones that went. */
  removeByHost(alias: string): Promise<readonly string[]>;
}

export function createSshProjectRepository(filePath: string): SshProjectRepository {
  const store = createSshStore<readonly StoredProject[]>(filePath, {
    member: "projects",
    read: readStoredProjects,
  });

  const committed = async (): Promise<readonly StoredProject[]> => {
    const read = await store.read();
    if (read.kind === "unusable") throw storeUnavailableError(filePath, read);
    return read.kind === "usable" ? read.value : [];
  };

  const current = (read: SshStoreRead<readonly StoredProject[]>): readonly StoredProject[] =>
    read.kind === "usable" ? read.value : [];

  return {
    async list() {
      return (await committed()).map(toRecord);
    },

    async get(id) {
      const found = (await committed()).find((project) => project.id === id);
      return found ? toRecord(found) : undefined;
    },

    async save(record) {
      const stored: StoredProject = {
        id: record.id ?? `ssh-project-${randomUUID()}`,
        alias: record.alias,
        path: record.path,
        displayName: record.displayName,
      };
      const { result } = await store.transact(
        (read): SshStoreChange<readonly StoredProject[], SshProjectRecord> => ({
          kind: "commit",
          value: [...current(read).filter((project) => project.id !== stored.id), stored],
          result: toRecord(stored),
        }),
      );
      return result;
    },

    async remove(id) {
      const { result } = await store.transact(
        (read): SshStoreChange<readonly StoredProject[], boolean> => {
          const projects = current(read);
          const remaining = projects.filter((project) => project.id !== id);
          if (remaining.length === projects.length) return { kind: "keep", result: false };
          return { kind: "commit", value: remaining, result: true };
        },
      );
      return result;
    },

    async removeByHost(alias) {
      const { result } = await store.transact(
        (read): SshStoreChange<readonly StoredProject[], readonly string[]> => {
          const projects = current(read);
          const removed = projects.filter((project) => project.alias === alias);
          if (removed.length === 0) return { kind: "keep", result: [] };
          return {
            kind: "commit",
            value: projects.filter((project) => project.alias !== alias),
            result: removed.map((project) => project.id),
          };
        },
      );
      return result;
    },
  };
}

/** The default location of the project store under a runtime data directory. */
export function sshProjectStorePath(dataDir: string): string {
  return path.join(dataDir, "ssh", "projects.json");
}

function toRecord(stored: StoredProject): SshProjectRecord {
  return {
    id: stored.id,
    alias: stored.alias,
    path: stored.path,
    displayName: stored.displayName,
  };
}

/**
 * The committed project records, validated field by field.
 *
 * Every field is required here: a project without its host, its path or its name cannot be shown
 * and cannot be removed by the thing that names it, which is why one refusal for the whole
 * document is better than a filtered list.
 */
function readStoredProjects(
  value: unknown,
): { readonly ok: true; readonly value: readonly StoredProject[] } | { readonly ok: false; readonly detail: string } {
  const projects: StoredProject[] = [];
  for (const [index, entry] of (value as readonly unknown[]).entries()) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, detail: `第 ${index + 1} 条项目记录不是对象` };
    }
    const record = entry as Record<string, unknown>;
    for (const key of ["id", "alias", "path", "displayName"] as const) {
      if (typeof record[key] !== "string" || record[key] === "") {
        return { ok: false, detail: `第 ${index + 1} 条项目记录缺少 ${key}` };
      }
    }
    projects.push({
      id: record.id as string,
      alias: record.alias as string,
      path: record.path as string,
      displayName: record.displayName as string,
    });
  }
  return { ok: true, value: projects };
}

/** The project-not-found failure, so the service and the terminal say it the same way. */
export function projectNotFound(): SshRuntimeError {
  return new SshRuntimeError("project_not_found", "没有找到这个 SSH 项目。");
}
