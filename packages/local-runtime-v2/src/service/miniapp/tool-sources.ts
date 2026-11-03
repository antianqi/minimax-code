// Where a page's tool names come from, and how a name gets back to its source.
//
// A page never learns which package, server or provider is behind a tool: it sees one
// flat list of names, and a name is enough to call it. That flatness is bought here,
// and paid for in one place, so the two things that go with it stay true:
//
//   * **The prefixes are the only naming rule.** `mcp__<server>__<tool>` and
//     `connector__<provider>__<tool>`. Both are built and parsed in this file; nothing
//     else composes a tool name.
//   * **A name is split at its first separator.** The provider and the server name are
//     bounded identifiers, while a tool name is the server's own and may contain
//     separators — splitting the other way would chop a tool in half.
//
// Which sources exist is decided before this port is built: a source that is off is
// simply absent. This file does not know what "installed" or "enabled" mean.

import { MiniAppToolError, isMiniAppToolNameWithinLimit } from './contracts.js';
import type { MiniAppHostTool, MiniAppHostToolPort } from './tool-gateway.js';

const SEPARATOR = '__';
const MCP_PREFIX = 'mcp';
const CONNECTOR_PREFIX = 'connector';

/** The name a page sees for one MCP tool of one server. */
export function miniAppMcpToolName(serverName: string, toolName: string): string {
  return `${MCP_PREFIX}${SEPARATOR}${serverName}${SEPARATOR}${toolName}`;
}

/** The name a page sees for one tool of one connector provider. */
export function miniAppConnectorToolName(provider: string, toolName: string): string {
  return `${CONNECTOR_PREFIX}${SEPARATOR}${provider}${SEPARATOR}${toolName}`;
}

/** The MCP tools of one page's world: installed and enabled servers, already resolved. */
export interface MiniAppMcpToolSource {
  list(): Promise<
    readonly { readonly serverName: string; readonly name: string; readonly description?: string }[]
  >;
  call(input: {
    readonly serverName: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
}

/** The connector tools of one page's world: the providers the person left on. */
export interface MiniAppConnectorToolSource {
  list(): Promise<
    readonly { readonly provider: string; readonly name: string; readonly description?: string }[]
  >;
  call(input: {
    readonly provider: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface MiniAppHostToolSources {
  readonly mcp?: MiniAppMcpToolSource;
  readonly connectors?: MiniAppConnectorToolSource;
}

/** A tool the page will not see, and why. */
export type MiniAppHostToolDiagnostic =
  | { readonly name: string; readonly kind: 'too-long' };

/** What a page's tool list is built from, plus the names it had to drop. */
export interface MiniAppHostToolSourcePort extends MiniAppHostToolPort {
  /** The names the last listing withheld because they could not be sent. */
  diagnostics(): readonly MiniAppHostToolDiagnostic[];
}

/**
 * The merged view the gateway reads.
 *
 * A name belongs to whichever source listed it first — MCP before connectors, as desktop
 * merges them — and a later source claiming the same name is dropped silently. Two
 * plugins declaring the same MCP server name still produce one page-visible tool, so a
 * page can never reach a tool by a name it did not see.
 *
 * A name too long to send is not offered at all: it could not be called anyway. That one
 * is reported, because it is a tool an operator expects and the page cannot see.
 *
 * The listing is remembered so a call can check that the name it was given is one the
 * page was actually offered; `list()` replaces it.
 */
export function createMiniAppHostToolPort(
  sources: MiniAppHostToolSources,
): MiniAppHostToolSourcePort {
  let served: ReadonlySet<string> | undefined;
  let dropped: readonly MiniAppHostToolDiagnostic[] = [];

  const listing = async (): Promise<readonly MiniAppHostTool[]> => {
    const names: MiniAppHostTool[] = [];
    const seen = new Set<string>();
    const diagnostics: MiniAppHostToolDiagnostic[] = [];
    const offer = (tool: MiniAppHostTool): void => {
      if (!isMiniAppToolNameWithinLimit(tool.name)) {
        diagnostics.push({ name: tool.name, kind: 'too-long' });
        return;
      }
      if (seen.has(tool.name)) return;
      seen.add(tool.name);
      names.push(tool);
    };

    for (const tool of (await sources.mcp?.list()) ?? []) {
      offer({
        name: miniAppMcpToolName(tool.serverName, tool.name),
        ...(tool.description !== undefined ? { description: tool.description } : {}),
      });
    }
    for (const tool of (await sources.connectors?.list()) ?? []) {
      offer({
        name: miniAppConnectorToolName(tool.provider, tool.name),
        ...(tool.description !== undefined ? { description: tool.description } : {}),
      });
    }
    served = seen;
    dropped = diagnostics;
    return names;
  };

  return {
    list: listing,
    diagnostics: () => dropped,
    async call(name, input, signal) {
      if (served === undefined) await listing();
      // The last check before dispatch: a name has to be one this port offered.
      if (!served?.has(name)) throw new MiniAppToolError('TOOL_NOT_FOUND');
      const split = splitToolName(name);
      if (split === undefined) throw new MiniAppToolError('TOOL_NOT_FOUND');
      if (split.source === 'mcp') {
        if (!sources.mcp) throw new MiniAppToolError('TOOL_NOT_FOUND');
        return sources.mcp.call({
          serverName: split.owner,
          name: split.tool,
          arguments: input,
          ...(signal ? { signal } : {}),
        });
      }
      if (!sources.connectors) throw new MiniAppToolError('TOOL_NOT_FOUND');
      return sources.connectors.call({
        provider: split.owner,
        name: split.tool,
        arguments: input,
        ...(signal ? { signal } : {}),
      });
    },
  };
}

type SplitToolName =
  | { readonly source: 'mcp'; readonly owner: string; readonly tool: string }
  | { readonly source: 'connector'; readonly owner: string; readonly tool: string };

function splitToolName(name: string): SplitToolName | undefined {
  for (const [prefix, source] of [
    [MCP_PREFIX, 'mcp'],
    [CONNECTOR_PREFIX, 'connector'],
  ] as const) {
    const head = `${prefix}${SEPARATOR}`;
    if (!name.startsWith(head)) continue;
    const rest = name.slice(head.length);
    const boundary = rest.indexOf(SEPARATOR);
    // No owner, no tool: a name has to have both parts to be one this file built.
    if (boundary <= 0 || boundary >= rest.length - SEPARATOR.length) return undefined;
    return {
      source,
      owner: rest.slice(0, boundary),
      tool: rest.slice(boundary + SEPARATOR.length),
    };
  }
  return undefined;
}
