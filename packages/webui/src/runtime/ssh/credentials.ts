// The staged password.
//
// The electron app keeps a password in its encrypted store and hands it to OpenSSH through an
// askpass helper. The WebUI service has no OS keychain to encrypt into — it is a loopback
// service, not the electron app's main process — so the password is staged **in memory only**:
//
//   * it is never written to the data directory,
//   * it never travels back to the browser, and
//   * it disappears with the process.
//
// The consequence is stated rather than hidden: a host that needs a password has to be handed one
// again after the service restarts. Storing it in plaintext on disk to avoid that would be a worse
// trade than asking once more.
import { SshRuntimeError } from "./errors.js";
import { isValidSshPassword } from "./validators.js";

export interface SshCredentialStore {
  /** Retain every password the attempt could receive until its output has been redacted. */
  captureRedaction(alias: string): { redact(value: string): string; dispose(): void };
  /** Stage a password for one host. The previous one, if any, is replaced. */
  stage(alias: string, password: string): void;
  /** The staged password for one host, if there is one. */
  get(alias: string): string | undefined;
  /** Forget one host's password. */
  remove(alias: string): void;
  /** Forget every password. */
  clear(): void;
}

export function createSshCredentialStore(): SshCredentialStore {
  const staged = new Map<string, string>();
  const captures = new Map<string, Set<Set<string>>>();
  return {
    captureRedaction(alias) {
      const passwords = new Set<string>();
      const initial = staged.get(alias);
      if (initial !== undefined) passwords.add(initial);
      const observers = captures.get(alias) ?? new Set<Set<string>>();
      captures.set(alias, observers);
      observers.add(passwords);
      return {
        redact(value) {
          for (const password of [...passwords].sort((left, right) => right.length - left.length)) {
            value = value.split(password).join("***");
          }
          return value;
        },
        dispose() {
          observers.delete(passwords);
          if (observers.size === 0 && captures.get(alias) === observers) captures.delete(alias);
          passwords.clear();
        },
      };
    },
    stage(alias, password) {
      if (!isValidSshPassword(password)) {
        throw new SshRuntimeError(
          "credential_unavailable",
          "密码不可用：密码不能为空、不能包含换行，且不能超过 1023 字节。",
        );
      }
      staged.set(alias, password);
      for (const capture of captures.get(alias) ?? []) capture.add(password);
    },
    get: (alias) => staged.get(alias),
    remove: (alias) => {
      staged.delete(alias);
    },
    clear: () => staged.clear(),
  };
}
