// The SSH runtime, composed.
//
// The whole vertical lives here: the saved hosts, the projects rooted on them, the remote folder
// browser and the remote terminal. The service owns the data directory and the transport; the
// harness adapter in `runtime/harness/ssh.ts` forwards to what this module returns and converts
// the records into the wire DTOs.
//
// Nothing in this module is reachable from the browser: the browser never sees a credential, never
// spawns a process and never names a path on a remote machine.
import path from "node:path";

import type { SshAskpassService, CreateSshAskpassServiceOptions } from "./askpass.js";
import { createSshAuthentication, type SshAuthentication } from "./authentication.js";
import { createSshConnectionService, type SshConnectionService } from "./connection-service.js";
import {
  createSshConnectionRepository,
  sshConnectionStorePath,
  type SshConnectionRepository,
} from "./connection-repository.js";
import { createSshCredentialStore, type SshCredentialStore } from "./credentials.js";
import {
  DEFAULT_SSH_DISCOVERY_DEPENDENCIES,
  discoverSshHosts,
  type SshDiscoveryDependencies,
} from "./host-discovery.js";
import { createSshProjectService, type SshProjectService } from "./project-service.js";
import {
  createSshProjectRepository,
  sshProjectStorePath,
  type SshProjectRepository,
} from "./project-repository.js";
import { createSshTerminalService, type SshTerminalService } from "./terminal.js";
import { createSystemSshTransport, type SshTransport } from "./transport.js";
import type { SshDiscoveryRecord } from "./types.js";

export interface SshRuntime {
  readonly connections: SshConnectionService;
  readonly projects: SshProjectService;
  readonly terminals: SshTerminalService;
  /** Whether this host can deliver a staged password, and why not when it cannot. */
  readonly authentication: SshAuthentication;
  /** The hosts in `~/.ssh/config`. */
  readonly discovery: () => Promise<SshDiscoveryRecord>;
  /** Release the terminals and the askpass helper. */
  readonly dispose: () => Promise<void>;
}

export interface CreateSshRuntimeOptions {
  /** The runtime's data directory. The stores live in its `ssh/` subdirectory. */
  readonly dataDir: string;
  /** The transport. Defaults to the system `ssh` binary. */
  readonly transport?: SshTransport;
  /** The dependencies the discovery reads `~/.ssh/config` with. */
  readonly discovery?: SshDiscoveryDependencies;
  /** The home directory a `~` in a key path is expanded against. */
  readonly homeDirectory?: () => string;
  /**
   * The askpass factory. A test overrides it to exercise a host where the helper cannot be
   * built; the runtime records the failure and keeps serving key authentication.
   */
  readonly createAskpass?: (options: CreateSshAskpassServiceOptions) => Promise<SshAskpassService>;
}

export async function createSshRuntime(options: CreateSshRuntimeOptions): Promise<SshRuntime> {
  const transport = options.transport ?? createSystemSshTransport();
  const credentials: SshCredentialStore = createSshCredentialStore();

  // The askpass helper needs a directory of its own and a socket. Whether it exists is part of
  // the runtime's answer, not something each caller re-derives: a host that cannot deliver a
  // password says so when one is handed to it, and keeps key authentication available.
  const authentication = await createSshAuthentication({
    rootDir: path.join(options.dataDir, "ssh"),
    credentials,
    ...(options.createAskpass ? { createAskpass: options.createAskpass } : {}),
  });

  const connectionRepository: SshConnectionRepository = createSshConnectionRepository(
    sshConnectionStorePath(options.dataDir),
  );
  const projectRepository: SshProjectRepository = createSshProjectRepository(
    sshProjectStorePath(options.dataDir),
  );

  // The hosts the config file declares. The connection service asks it whether an alias is
  // still there, and the runtime answers the same discovery.
  const discovery = (): Promise<SshDiscoveryRecord> =>
    discoverSshHosts(options.discovery ?? DEFAULT_SSH_DISCOVERY_DEPENDENCIES);

  const connections = createSshConnectionService({
    repository: connectionRepository,
    projects: projectRepository,
    transport,
    credentials,
    authentication,
    ...(options.homeDirectory ? { homeDirectory: options.homeDirectory } : {}),
    discoverHosts: discovery,
  });
  const projects = createSshProjectService({
    repository: projectRepository,
    connections: connectionRepository,
    transport,
    credentials,
    authentication,
  });
  const terminals = createSshTerminalService({
    connections: connectionRepository,
    projects: projectRepository,
    transport,
    authentication,
  });

  return {
    connections,
    projects,
    terminals,
    authentication,
    discovery,
    dispose: async () => {
      terminals.dispose();
      credentials.clear();
      await authentication.dispose();
    },
  };
}

export type { SshConnectionService, SshProjectService, SshTerminalService };
export type { SshAuthentication, SshAuthenticationAvailability } from "./authentication.js";
export type { SshConnectionRecord, SshDiscoveryRecord, SshEndpointRecord, SshProbeRecord, SshProjectRecord, SshTerminalSessionRecord } from "./types.js";
