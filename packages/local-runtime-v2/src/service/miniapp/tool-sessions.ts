// What a page's three tool methods mean on the host side.
//
// The gateway decides one call; this decides what `list()`, `request()` and `call()`
// are. They differ in more than their names:
//
//   * `list()` answers the tools **and their rules**, so a page can show which of them
//     will prompt. One read of the rules for the whole listing, not one per tool.
//   * `request()` is about asking, not calling: it puts the tools the rules still call
//     `ask` in front of a person and answers the resulting state of every tool it was
//     asked about. A page uses it to build a "choose what this app may do" screen.
//   * `call()` runs one tool through the gateway's whole gate — switch, name, rules,
//     approval — and answers the tool's own result.
//
// The one identity a call carries is the plugin id, and it is the host's: a page cannot
// supply it. Everything else in a request is a tool name.

import {
  createMiniAppToolGateway,
  type MiniAppHostToolPort,
  type MiniAppToolAuditPort,
  type MiniAppToolCaller,
  type MiniAppToolGateway,
  type MiniAppToolSession,
} from './tool-gateway.js';
import {
  requestMiniAppToolPermissions,
  type MiniAppToolApprovalPort,
  type MiniAppToolPermissionOutcome,
  type MiniAppToolRulePort,
} from './tool-permission.js';
import type { MiniAppPermissionSwitchPort } from './contracts.js';
import { MiniAppToolError } from './contracts.js';

/** The three things a page can ask for. */
export type MiniAppToolRequestMethod = 'list' | 'request' | 'call';

export interface MiniAppToolRunInput {
  readonly pluginId: string;
  /**
   * The running generation the call belongs to.
   *
   * A tool port is bound to one process generation: the connector gateway registers and
   * releases by `(pluginId, processGeneration)`, and the MCP inventory follows the
   * current snapshot. A session therefore belongs to a generation, not to a plugin.
   */
  readonly processGeneration?: string;
  readonly method: MiniAppToolRequestMethod;
  readonly name?: string;
  readonly names?: readonly string[];
  readonly arguments?: unknown;
  readonly signal?: AbortSignal;
}

/** A listing as the page receives it. */
export interface MiniAppToolListingAnswer {
  readonly tools: readonly {
    readonly name: string;
    readonly description?: string;
    readonly decision: 'allow' | 'ask' | 'deny';
  }[];
}

/** A call's answer: the tool's own result, relayed rather than interpreted. */
export interface MiniAppToolCallAnswer {
  readonly value: unknown;
}

/**
 * One answer a page's tool channel can give.
 *
 * One name for the union so the layers that only carry it (the application contract, the
 * CLI facade, the wire) do not each spell it out and drift from it.
 */
export type MiniAppToolAnswer =
  | MiniAppToolListingAnswer
  | MiniAppToolPermissionOutcome
  | MiniAppToolCallAnswer;

export interface MiniAppToolSessionsOptions {
  /**
   * The Host's tools for one caller: MCP servers and connectors, already limited to
   * what it serves.
   *
   * A function rather than a port because a connector call is registered and released
   * by `(pluginId, processGeneration)` — the port has to be built for the generation
   * that will use it, and a generation changes every time the app starts. The port is
   * built once per session, not once per call.
   */
  readonly tools: (caller: MiniAppToolCaller) => MiniAppHostToolPort;
  /** Whether the package's manifest declares `toolAccess: ['call']`. */
  readonly declaresToolAccess: (pluginId: string) => boolean | Promise<boolean>;
  readonly permissionSwitches?: MiniAppPermissionSwitchPort;
  readonly permissions?: MiniAppToolRulePort;
  readonly approvals?: MiniAppToolApprovalPort;
  /** The Host's record of what a page tried and what came of it. */
  readonly audit?: MiniAppToolAuditPort;
  /** The gateway factory. Injected so this layer can be driven by a scripted session. */
  readonly createGateway?: (options: {
    readonly tools: MiniAppHostToolPort;
    readonly permissionSwitches?: MiniAppPermissionSwitchPort;
    readonly declaresToolAccess: (pluginId: string) => boolean;
    readonly permissions?: MiniAppToolRulePort;
    readonly approvals?: MiniAppToolApprovalPort;
    readonly audit?: MiniAppToolAuditPort;
  }) => MiniAppToolGateway;
}

export interface MiniAppToolSessions {
  /**
   * One request, answered.
   *
   * Throws the gateway's own `MiniAppToolError` for a refusal: the caller turns the code
   * into the page's answer, and only the code travels.
   */
  run(input: MiniAppToolRunInput): Promise<MiniAppToolAnswer>;
}

export function createMiniAppToolSessions(
  options: MiniAppToolSessionsOptions,
): MiniAppToolSessions {
  /**
   * One session per plugin, replaced when the plugin's generation changes.
   *
   * Keyed by plugin (not by generation) so the map cannot grow with every restart: a
   * plugin has one live generation at a time, and the session that belonged to the
   * previous one would point at a process that is gone.
   */
  const sessions = new Map<string, { generation?: string; session: MiniAppToolSession }>();
  const build = options.createGateway ?? createMiniAppToolGateway;

  /**
   * The session for one plugin and generation, with its declaration resolved once.
   *
   * A manifest's `toolAccess` is an install-time fact: it cannot change while the
   * package is installed, so resolving it per call would be a read for every tool call
   * that always answers the same thing. The generation is not an install-time fact, so
   * a changed one rebuilds the session.
   */
  const sessionFor = async (input: {
    pluginId: string;
    processGeneration?: string;
  }): Promise<MiniAppToolSession> => {
    const existing = sessions.get(input.pluginId);
    if (existing && existing.generation === input.processGeneration) return existing.session;
    const declared = await options.declaresToolAccess(input.pluginId);
    const caller: MiniAppToolCaller = {
      pluginId: input.pluginId,
      ...(input.processGeneration !== undefined
        ? { processGeneration: input.processGeneration }
        : {}),
    };
    const session = build({
      tools: options.tools(caller),
      declaresToolAccess: () => declared,
      ...(options.permissionSwitches ? { permissionSwitches: options.permissionSwitches } : {}),
      ...(options.permissions ? { permissions: options.permissions } : {}),
      ...(options.approvals ? { approvals: options.approvals } : {}),
      ...(options.audit ? { audit: options.audit } : {}),
    }).open(caller);
    sessions.set(input.pluginId, { generation: input.processGeneration, session });
    return session;
  };

  return {
    async run(input) {
      const session = await sessionFor(input);
      switch (input.method) {
        case 'list':
          return { tools: await session.list() };
        case 'request':
          return requestMiniAppToolPermissions(
            {
              ...(options.permissions ? { permissions: options.permissions } : {}),
              ...(options.approvals ? { approvals: options.approvals } : {}),
            },
            {
              pluginId: input.pluginId,
              targets: (input.names ?? []).map((name) => ({ name })),
              ...(input.signal ? { signal: input.signal } : {}),
            },
          );
        case 'call':
          if (input.name === undefined) {
            // The page's validator refuses this before it becomes a request; a host that
            // receives one anyway answers the same way rather than calling `undefined`.
            throw new MiniAppToolError('INVALID_ARGUMENTS');
          }
          return {
            value: await session.call(input.name, input.arguments, input.signal),
          };
      }
    },
  };
}
