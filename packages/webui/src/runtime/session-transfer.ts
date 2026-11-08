import type { WebuiHarnessPort } from "./port.js";

// Importing a session transfer into a target session.
//
// The transfer *format* lives in the runtime
// (`@mavis/local-runtime-v2` -> `SessionTransferApplication`), which is the
// only layer that can read both storage layers without losing anything. The
// download *name* is shared by both sides of the HTTP boundary and lives in
// `shared/session-transfer-format.ts`.
//
// An earlier version also read `messages.jsonl` straight off disk and walked
// `getMessages` for the display side, so that no port change was needed. That
// produced a file that looked complete but was not: `getMessages` returns a
// view prepared for rendering, and on roughly 1% of real rows -- every
// compaction and fork-origin row -- it drops the `operationId` and
// `committedRevision` receipts that tie a display row back to the canonical
// event that produced it.

/**
 * The runtime capabilities the session-import workflow uses. Declared as a
 * `Pick` of the harness port so the workflow cannot reach for anything else.
 */
export type WebuiSessionImportCapabilities = Pick<
  WebuiHarnessPort,
  "createSession" | "importSessionTransfer" | "updateSession" | "deleteSession"
>;

/** The wire body a successful import answers with. */
export type WebuiSessionImportBody = Extract<WebuiSessionImportOutcome, { kind: "imported" }>["body"];

/**
 * What the import workflow did, independent of the transport that called it.
 * The HTTP route maps these onto the exact status codes and bodies it served
 * before the workflow moved out of the handler.
 */
export type WebuiSessionImportOutcome = Awaited<ReturnType<NonNullable<WebuiHarnessPort["importSessionTransferWorkflow"]>>>;

/**
 * Recreate a session from a transfer file.
 *
 * `WebuiCreateSessionRequest.name` is the *agent* to run under, not a title.
 * Both the agent and the working directory are supplied by the caller -- the
 * context the user is importing into -- and never read from the payload. A
 * downloaded file is untrusted input: if its session block could name an agent
 * or a workspace, importing a file could aim a session at an arbitrary
 * directory on this machine, or ask for an agent that does not exist and take
 * the whole import down with it. The file contributes its history and its
 * title; the caller contributes who and where.
 *
 * Validation failures delete the empty shell when possible and report cleanup
 * failures. Later history or title failures retain the session for recovery.
 */
export async function importWebuiSessionTransfer(
  port: WebuiSessionImportCapabilities,
  input: {
    readonly file: unknown;
    readonly agentName: string;
    readonly workspaceDir?: string;
  },
): Promise<WebuiSessionImportOutcome> {
  let sessionId: string;
  try {
    const created = await port.createSession({
      name: input.agentName,
      ...(input.workspaceDir ? { workspaceDir: input.workspaceDir } : {}),
    });
    const id = created.sessionId ?? created.session?.sessionId;
    if (!id) throw new Error("Session creation returned no id");
    sessionId = id;
  } catch (error) {
    // The caller gets a status code, not a stack trace, so the reason has
    // to land somewhere or a 500 here is undiagnosable. Only the message:
    // the payload is untrusted and the error can quote it back.
    console.error(`[webui] session import could not create a session: ${describeError(error)}`);
    return { kind: "create-failed" };
  }

  let stage: "history" | "title" = "history";
  try {
    const result = await port.importSessionTransfer({
      targetSessionId: sessionId,
      sourceSessionId: readImportSourceId(input.file),
      file: input.file,
    });
    stage = "title";
    const title = readImportTitle(input.file);
    if (title) await port.updateSession({ id: result.sessionId, title });
    return {
      kind: "imported",
      body: {
        sessionId: result.sessionId,
        canonicalMessages: result.canonicalMessages,
        displayMessages: result.displayMessages,
        revision: result.revision,
      },
    };
  } catch (error) {
    // "Not a transfer file at all" is the user's mistake and worth saying so;
    // anything else means the file parsed but could not be replayed.
    const foreign = (error as { readonly code?: unknown } | undefined)?.code === "not-a-transfer-file";
    const code = (error as { readonly code?: unknown } | undefined)?.code;
    let compensation: Extract<WebuiSessionImportOutcome, { kind: "not-transfer-file" | "import-failed" }>["compensation"] = { kind: "retained" };
    // Validation errors precede all writes. Any later failure may already have
    // published canonical history; retain it for recovery, including title errors.
    if (stage === "history" && (foreign || code === "malformed-transfer-file")) {
      try {
        const deleted = await port.deleteSession({ id: sessionId });
        if (!deleted.success) throw new Error("Session cleanup was not confirmed");
        compensation = { kind: "deleted" };
      } catch (cleanupError) {
        compensation = { kind: "failed", failure: describeError(cleanupError) };
      }
    }
    console.error(`[webui] session import failed: ${describeError(error)}`);
    return { kind: foreign ? "not-transfer-file" : "import-failed", sessionId, stage, failure: describeError(error), compensation };
  }
}

function readImportSession(file: unknown): Record<string, unknown> | undefined {
  const session = (file as { readonly session?: unknown } | undefined)?.session;
  return typeof session === "object" && session !== null && !Array.isArray(session)
    ? (session as Record<string, unknown>)
    : undefined;
}

/** Trimmed, length-capped strings only -- the payload is untrusted. */
function readImportString(file: unknown, key: "title" | "agentName" | "workspaceDir"): string | undefined {
  const value = readImportSession(file)?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

function readImportTitle(file: unknown): string | undefined {
  return readImportString(file, "title");
}

function readImportSourceId(file: unknown): string | undefined {
  const value = readImportSession(file)?.sessionId;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : undefined;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 300 ? `${message.slice(0, 300)}...` : message;
}
