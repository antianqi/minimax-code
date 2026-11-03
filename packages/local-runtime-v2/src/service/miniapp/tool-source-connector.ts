// The connector half of a page's tool list: provider switch, inventory, and calls.
//
// A page knows connectors only as tools. This adapter is what turns the host connector
// gateway's inventory into that view, and turns a `(provider, tool)` back into the
// handle the gateway issued.
//
// Three properties are worth stating, because each is a decision:
//
//   * **The provider switch is read on every listing and every call.** A provider turned
//     off disappears from the next listing, and a call for it is refused even though a
//     handle from an earlier listing is still in hand — the same rule the subprocess
//     connector path applies, applied one layer up.
//   * **A name from a listing this adapter has not seen is resolved once.** Providers
//     come and go; re-reading the inventory is cheaper than a false "no such tool".
//   * **A partial inventory still lists what answered.** One provider failing is a
//     failure the gateway reports, not a reason to hide the others.

import { randomUUID } from 'node:crypto';

import { MiniAppToolError } from './contracts.js';
import type { MiniAppConnectorToolSource } from './tool-sources.js';

/** Who is calling, as the connector gateway records it. */
export interface MiniAppConnectorCaller {
  readonly kind: 'host-process';
  readonly pluginId: string;
  readonly processGeneration: string;
}

/** The request identity a call carries into the gateway's audit. */
export interface MiniAppConnectorRequestContext {
  readonly clientRequestId: string;
  readonly invocationId: string;
}

/** The slice of the host connector gateway this adapter uses. */
export interface MiniAppConnectorGatewayPort {
  list(input: {
    readonly providerAllowlist: readonly string[] | 'all';
    readonly caller: MiniAppConnectorCaller;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly tools: readonly {
      /**
       * The gateway's own capability for the tool. Opaque here on purpose: this adapter
       * proves a name came from a listing and hands the handle back untouched, so the
       * shape the connector system uses stays that system's business.
       */
      readonly handle: unknown;
      readonly provider: string;
      readonly providerToolName: string;
      readonly description?: string;
    }[];
    readonly partial: boolean;
  }>;
  call(input: {
    readonly handle: unknown;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly caller: MiniAppConnectorCaller;
    readonly hostRequest: MiniAppConnectorRequestContext;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface MiniAppConnectorToolSourceOptions {
  readonly gateway: MiniAppConnectorGatewayPort;
  readonly caller: MiniAppConnectorCaller;
  /**
   * Which providers the page may see.
   *
   * `'all'` — the default — is the page channel's rule, and the one the shipped client
   * uses: the account's own Connector grants are the only provider filter here. The
   * manifest's `hostConnectorAccess` list governs the *subprocess* channel, not this one,
   * and the `connector:<provider>` switches govern it too; a page's gate is `tool:call`
   * plus the per-tool rules.
   */
  readonly providerAllowlist?: readonly string[] | 'all';
  readonly makeHostRequest?: () => MiniAppConnectorRequestContext;
}

/** The separator no provider or tool name may contain in practice; a plain key. */
const KEY_SEPARATOR = '\u0000';

export function createMiniAppConnectorToolSource(
  options: MiniAppConnectorToolSourceOptions,
): MiniAppConnectorToolSource {
  const handles = new Map<string, unknown>();

  const list = async (): Promise<
    readonly { provider: string; name: string; description?: string }[]
  > => {
    const allowlist = options.providerAllowlist ?? 'all';
    if (allowlist !== 'all' && allowlist.length === 0) return [];
    const inventory = await options.gateway.list({
      providerAllowlist: allowlist,
      caller: options.caller,
    });
    const tools: Array<{ provider: string; name: string; description?: string }> = [];
    const seen = new Set<string>();
    for (const tool of inventory.tools) {
      const key = keyOf(tool.provider, tool.providerToolName);
      handles.set(key, tool.handle);
      if (seen.has(key)) continue;
      seen.add(key);
      tools.push({
        provider: tool.provider,
        name: tool.providerToolName,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
      });
    }
    return tools;
  };

  return {
    list,
    async call(input) {
      const key = keyOf(input.provider, input.name);
      if (!handles.has(key)) await list();
      const handle = handles.get(key);
      if (handle === undefined) throw new MiniAppToolError('TOOL_NOT_FOUND');
      return options.gateway.call({
        handle,
        arguments: input.arguments as Readonly<Record<string, unknown>>,
        caller: options.caller,
        hostRequest: (options.makeHostRequest ?? defaultHostRequest)(),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
  };
}

function keyOf(provider: string, toolName: string): string {
  return `${provider}${KEY_SEPARATOR}${toolName}`;
}

function defaultHostRequest(): MiniAppConnectorRequestContext {
  return { clientRequestId: randomUUID(), invocationId: randomUUID() };
}
