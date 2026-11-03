// The SSH runtime's own failure vocabulary.
//
// The vocabulary is `invalid_input`, `operation_in_progress` and
// `credential_unavailable`, plus the ones this port needs (`connection_not_found`,
// `project_not_found`, `terminal_not_found`, `ssh_not_found`,
// `storage_unavailable`).
//
// The code is what reaches the browser as the operation's `error` field. It never carries the
// password, a credential or a raw stderr dump: the detail that reaches the browser is a short,
// already-redacted sentence.
export type SshErrorCode =
  | "invalid_input"
  | "operation_in_progress"
  | "credential_unavailable"
  | "connection_not_found"
  | "project_not_found"
  | "terminal_not_found"
  | "ssh_not_found"
  | "storage_unavailable";

export class SshRuntimeError extends Error {
  readonly code: SshErrorCode;

  constructor(code: SshErrorCode, message: string) {
    super(message);
    this.name = "SshRuntimeError";
    this.code = code;
  }
}

export function isSshRuntimeError(error: unknown): error is SshRuntimeError {
  return error instanceof SshRuntimeError;
}

/** The one sentence a browser may read for a failure. */
export function sshErrorMessage(error: unknown, fallback: string): string {
  if (isSshRuntimeError(error)) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
