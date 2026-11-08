// Which authentication one SSH invocation uses, and whether it can be used at all.
//
// A staged password reaches OpenSSH through the askpass helper (`askpass.ts`). That helper needs
// a POSIX shell, a writable directory and a unix socket, so on some hosts it cannot exist. The
// runtime used to answer that failure by forgetting it: the askpass service became `undefined`,
// and every later call site asked only `askpass?.envFor(...)`. Two wrong things followed from
// that:
//
//   * a password was staged and reported as saved, although nothing could ever deliver it — the
//     person then saw a generic failed handshake instead of "this platform cannot deliver a
//     password";
//   * the invocation still chose the password-only option set (`PubkeyAuthentication=no`,
//     `PreferredAuthentications=password`), which turns off the key authentication that *would*
//     have worked.
//
// This module owns the decision instead. It is created once per runtime, it keeps the reason the
// helper could not be built, and it answers one question for all three callers — the probe, the
// remote folder listing and the remote terminal: key, password with an environment, or
// unavailable with the reason. No caller builds an `ssh` invocation from an optional helper any
// more, so "password only" is never chosen without a way to deliver the password.
import {
  createSshAskpassService,
  type CreateSshAskpassServiceOptions,
  type SshAskpassService,
} from "./askpass.js";
import type { SshCredentialStore } from "./credentials.js";
import { isSshRuntimeError } from "./errors.js";

/** Whether this host can deliver a staged password to OpenSSH. */
export type SshAuthenticationAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly code: "credential_unavailable";
      /** The reason the helper could not be built, as the runtime recorded it. */
      readonly reason: string;
    };

/** How one host's next invocation authenticates. */
export type SshAuthMode =
  | { readonly kind: "key" }
  | { readonly kind: "password"; readonly env: Record<string, string> }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface SshAuthentication {
  readonly availability: SshAuthenticationAvailability;
  /** The authentication mode for one host, from the password staged for it, if any. */
  modeFor(alias: string): SshAuthMode;
  /** Release the helper's socket. */
  dispose(): Promise<void>;
}

export interface CreateSshAuthenticationOptions {
  /** The directory the helper's files and socket live in. */
  readonly rootDir: string;
  readonly credentials: SshCredentialStore;
  /**
   * The helper factory. Overridden by a test that needs to see the failure path; the default
   * builds the real askpass service.
   */
  readonly createAskpass?: (options: CreateSshAskpassServiceOptions) => Promise<SshAskpassService>;
}

export async function createSshAuthentication(
  options: CreateSshAuthenticationOptions,
): Promise<SshAuthentication> {
  const createAskpass = options.createAskpass ?? createSshAskpassService;

  let askpass: SshAskpassService | undefined;
  let availability: SshAuthenticationAvailability = { available: true };
  try {
    askpass = await createAskpass({
      rootDir: options.rootDir,
      credentials: options.credentials,
    });
  } catch (error) {
    // The reason is kept, not swallowed: it is the answer the person gets when a password is
    // handed to a host that cannot deliver it.
    availability = {
      available: false,
      code: "credential_unavailable",
      reason: isSshRuntimeError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "SSH 密码助手无法启动。",
    };
  }

  return {
    availability,
    modeFor(alias) {
      if (options.credentials.get(alias) === undefined) return { kind: "key" };
      if (askpass) return { kind: "password", env: askpass.envFor(alias) };
      // A password is staged and cannot be delivered. Choosing the password option set here is
      // what silently disabled key authentication; the caller is told instead.
      return {
        kind: "unavailable",
        reason: availability.available ? "SSH 密码助手不可用。" : availability.reason,
      };
    },
    async dispose() {
      await askpass?.dispose();
    },
  };
}
