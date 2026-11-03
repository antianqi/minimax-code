// The host side of a Mini App's tool calls: what a page may see, and what it may run.
//
// Two decisions are made here, in this order, and both fail closed:
//
//   * **May this package use host tools at all** — the manifest declared
//     `toolAccess: ['call']`, and the person has left `tool:call` on. Off closes the
//     channel: the listing is empty and every call is refused before dispatch, so a
//     page cannot even name what it is not allowed to call.
//   * **May this call run** — the rules answer `allow`, `ask` or `deny` per tool; an
//     `ask` goes to the Mini App's own prompt, and with nobody to answer it the call is
//     refused rather than run.
//
// What is deliberately not here: the tool sources (installed MCP servers and
// connectors decide membership; this file only asks), the prompt's UI, and the
// page-side bridge that reaches this gateway. Each is a seam of its own.
//
// Two properties are worth stating, because both are decisions:
//
//   * **The switch is read per call, never cached.** A person who turns it off means
//     the next call, not the next restart. The listing is remembered only to answer
//     "is this a name this generation serves", and `list()` replaces it.
//   * **A refused name is not dispatched.** The name has to be one this session was
//     offered, so a page cannot reach a tool by guessing it.

import type { MiniAppPermissionSwitchPort } from './contracts.js';
import {
  MINIAPP_TOOL_CALL_PERMISSION,
  MiniAppToolError,
  isMiniAppToolNameWithinLimit,
} from './contracts.js';
import {
  currentMiniAppToolRules,
  judgeMiniAppToolCall,
  type MiniAppToolApprovalPort,
  type MiniAppToolRulePort,
  type MiniAppToolRuleVerdict,
} from './tool-permission.js';

export { MINIAPP_TOOL_CALL_PERMISSION, MiniAppToolError };

/** Who is calling: the package, and the process generation the view belongs to. */
export interface MiniAppToolCaller {
  readonly pluginId: string;
  readonly processGeneration?: string;
}

/** One tool the Host offers a page. */
export interface MiniAppHostTool {
  readonly name: string;
  readonly description?: string;
}

/** A tool as a page sees it: what it is, and what the rules say about it. */
export interface MiniAppToolListingEntry extends MiniAppHostTool {
  readonly decision: MiniAppToolRuleVerdict;
}

/**
 * The tools available to pages, already limited to what this Host serves.
 *
 * Sources (installed MCP servers, connectors) decide membership; this port only
 * answers. That keeps "which tools exist" out of the gate that decides "may this
 * package call them".
 */
export interface MiniAppHostToolPort {
  list(): Promise<readonly MiniAppHostTool[]>;
  call(name: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}

export interface MiniAppToolSession {
  /** The tools this session may call, with their rules. Empty when the channel is closed. */
  list(): Promise<readonly MiniAppToolListingEntry[]>;
  call(name: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}

/**
 * One line of the Host's record of a page's tool call.
 *
 * Two per attempt — the attempt, then its result — so a refusal is visible as a refusal
 * and a dispatch is visible as a dispatch. `outcome` is only on the result: at the moment
 * the attempt is written, whether it dispatches is not yet known.
 */
export interface MiniAppToolAuditEvent {
  readonly action: 'call' | 'result';
  readonly timestampMs: number;
  readonly pluginId: string;
  readonly processGeneration?: string;
  readonly name: string;
  /** On a result: whether the call reached the tool. */
  readonly outcome?: 'dispatched' | 'not_dispatched';
  readonly code?: string;
  readonly durationMs?: number;
}

/** Log-only: a record that throws must not change what the page is told. */
export interface MiniAppToolAuditPort {
  record(event: MiniAppToolAuditEvent): void | Promise<void>;
}

export interface MiniAppToolGatewayOptions {
  readonly tools: MiniAppHostToolPort;
  /**
   * The permission switches. Absent means this Host predates the permission model,
   * which is the one case where the switch cannot deny; the manifest still decides.
   */
  readonly permissionSwitches?: MiniAppPermissionSwitchPort;
  /** Whether the package's manifest allows host tool calls at all. */
  readonly declaresToolAccess: (pluginId: string) => boolean;
  /** The Host's rules. Absent means every tool is `ask`. */
  readonly permissions?: MiniAppToolRulePort;
  /** The Mini App view's prompt. Absent means an `ask` cannot be answered. */
  readonly approvals?: MiniAppToolApprovalPort;
  /** The Host's record of what a page tried and what came of it. */
  readonly audit?: MiniAppToolAuditPort;
}

export interface MiniAppToolGateway {
  /** The session for a caller. Two views of one package each get their own. */
  open(caller: MiniAppToolCaller): MiniAppToolSession;
}

export function createMiniAppToolGateway(
  options: MiniAppToolGatewayOptions,
): MiniAppToolGateway {
  return {
    open: (caller) => createSession(options, caller),
  };
}

function createSession(
  options: MiniAppToolGatewayOptions,
  caller: MiniAppToolCaller,
): MiniAppToolSession {
  /**
   * The last listing this session saw, kept only to answer "is this name served".
   * `list()` replaces it; a call without one reads the port once.
   */
  let served: ReadonlySet<string> | undefined;

  const permitted = (): boolean => {
    if (!options.declaresToolAccess(caller.pluginId)) return false;
    // No switch port is the pre-permission Host: the manifest alone decides. A switch
    // port that answers `false` is the person's decision and is final.
    return (
      options.permissionSwitches?.isEnabled(caller.pluginId, MINIAPP_TOOL_CALL_PERMISSION) ?? true
    );
  };

  const listing = async (): Promise<readonly MiniAppToolListingEntry[]> => {
    // The tools are listed even when the channel is closed, with every rule reported as
    // `deny`. That is what a page needs to render "this app can use these, switched off"
    // instead of an empty shelf it cannot tell from "no tools at all".
    const tools = await options.tools.list();
    if (!permitted()) {
      served = new Set(tools.map((tool) => tool.name));
      return tools.map((tool) => ({ ...tool, decision: 'deny' }));
    }
    served = new Set(tools.map((tool) => tool.name));
    // One read of the rules for the whole listing: twenty tools must not mean twenty
    // reads, and a listing that mixed two rule generations would be two moments.
    const decisions = await currentMiniAppToolRules(
      tools.map((tool) => ({ name: tool.name })),
      options.permissions,
    );
    return tools.map((tool, index) => ({
      ...tool,
      decision: decisions[index] ?? 'ask',
    }));
  };

  /**
   * The Host's record, written once per attempt, at its start and at its end.
   *
   * A record that throws is swallowed: audit is what the Host says about the call, not
   * something the call depends on.
   */
  const record = (event: Omit<MiniAppToolAuditEvent, 'pluginId' | 'processGeneration'>): void => {
    const audit = options.audit;
    if (!audit) return;
    try {
      void audit.record({
        ...event,
        pluginId: caller.pluginId,
        ...(caller.processGeneration !== undefined
          ? { processGeneration: caller.processGeneration }
          : {}),
      });
    } catch {
      // Log-only.
    }
  };

  return {
    async list() {
      return listing();
    },
    async call(name, input, signal) {
      const startedAtMs = Date.now();
      record({ action: 'call', timestampMs: startedAtMs, name });
      // Set only once the tool has actually been reached: a refusal before this point is
      // `not_dispatched`, a tool that throws after it is `dispatched`.
      let dispatched = false;
      try {
        if (!permitted()) throw new MiniAppToolError('TOOL_NOT_PERMITTED');
        if (!isMiniAppToolNameWithinLimit(name)) throw new MiniAppToolError('INVALID_ARGUMENTS');
        if (served === undefined) await listing();
        // A refusal is not a reason to dispatch: the name has to be one this session was
        // offered, so a page cannot reach a tool by guessing its name.
        if (!served?.has(name)) throw new MiniAppToolError('TOOL_NOT_FOUND');
        await judgeMiniAppToolCall(
          {
            permissions: options.permissions,
            approvals: options.approvals,
          },
          {
            pluginId: caller.pluginId,
            target: { name },
            arguments: input,
            ...(signal ? { signal } : {}),
          },
        );
        dispatched = true;
        const value = await options.tools.call(name, input, signal);
        record({
          action: 'result',
          timestampMs: Date.now(),
          name,
          outcome: 'dispatched',
          durationMs: Date.now() - startedAtMs,
        });
        return value;
      } catch (error) {
        record({
          action: 'result',
          timestampMs: Date.now(),
          name,
          outcome: dispatched ? 'dispatched' : 'not_dispatched',
          ...(refusalCode(error) !== undefined ? { code: refusalCode(error) } : {}),
          durationMs: Date.now() - startedAtMs,
        });
        throw error;
      }
    },
  };
}

/** The code the page will be told, when the failure carries one. */
function refusalCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return undefined;
}
