// The MCP half of a page's tool list: which servers answer, and calls through them.
//
// A page knows MCP servers only as the first segment of a tool name. This adapter is
// what turns "the servers the Host serves right now" into the tools of those servers,
// and a tool name back into the server it belongs to.
//
// Three properties, each a decision:
//
//   * **The served set is read on every listing and every call.** A server that stops
//     being served disappears from the next listing, and a call for it is refused even
//     though the page saw its tools a moment ago.
//   * **A server that fails to answer does not hide the others.** One MCP server going
//     away is a fact about that server; the tools of the rest are still real.
//   * **A call is resolved against a listing, not against the name.** A tool the server
//     does not offer is refused before dispatch, so a page cannot reach a tool by
//     constructing its name.
//
// Which servers the Host serves is not decided here: `servers()` answers, and whoever
// builds this adapter owns that join (the plugin snapshot).

import { MiniAppToolError } from './contracts.js';
import type { MiniAppMcpToolSource } from './tool-sources.js';

/** The slice of the host MCP runtime this adapter uses. */
export interface MiniAppMcpHostPort {
  /** The MCP servers served right now, read per call. */
  servers(): readonly string[];
  listTools(serverName: string): Promise<
    readonly { readonly name: string; readonly description?: string }[]
  >;
  callTool(input: {
    readonly serverName: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface MiniAppMcpToolSourceOptions {
  readonly host: MiniAppMcpHostPort;
}

export function createMiniAppMcpToolSource(
  options: MiniAppMcpToolSourceOptions,
): MiniAppMcpToolSource {
  /** What the last listing offered, kept only to answer "is this a name the page saw". */
  let offered: ReadonlySet<string> | undefined;

  const keyOf = (serverName: string, toolName: string): string =>
    `${serverName}\u0000${toolName}`;

  const list = async (): Promise<
    readonly { serverName: string; name: string; description?: string }[]
  > => {
    const served = options.host.servers();
    const tools: Array<{ serverName: string; name: string; description?: string }> = [];
    for (const serverName of served) {
      let listed: readonly { name: string; description?: string }[];
      try {
        listed = await options.host.listTools(serverName);
      } catch {
        // A server that threw is not a server whose tools exist. Skipping it keeps the
        // rest of the listing honest; the page is not told about a server it cannot use.
        continue;
      }
      for (const tool of listed) {
        // Reported as the server answered it, duplicates included: two servers claiming
        // one name is a collision the layer that composes page-visible names has to see,
        // and deduplicating here would hide one tool behind the other.
        tools.push({
          serverName,
          name: tool.name,
          ...(tool.description !== undefined ? { description: tool.description } : {}),
        });
      }
    }
    offered = new Set(tools.map((tool) => keyOf(tool.serverName, tool.name)));
    return tools;
  };

  return {
    list,
    async call(input) {
      // The served set first: a name is not a permission to use a server that is gone.
      if (!options.host.servers().includes(input.serverName)) {
        throw new MiniAppToolError('TOOL_NOT_PERMITTED');
      }
      if (!offered?.has(keyOf(input.serverName, input.name))) await list();
      if (!offered?.has(keyOf(input.serverName, input.name))) {
        throw new MiniAppToolError('TOOL_NOT_FOUND');
      }
      return options.host.callTool({
        serverName: input.serverName,
        name: input.name,
        arguments: input.arguments,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
  };
}
