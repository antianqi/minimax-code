// The Host's tool channel: built once, opened per page.
//
// This is the one place that says where a page's tools come from. It joins the two
// sources the Host serves — the installed MCP servers and the account's connectors —
// into the single port a session calls through, and it does that per caller, because a
// connector call is registered by `(pluginId, processGeneration)` and the generation
// changes every time the app restarts.
//
// Two consequences are deliberate:
//
//   * **A caller with no generation reaches no connector.** The connector gateway
//     attributes a call to a registered process; asking it to list for a process it
//     never saw would answer for something that is not there. An inline view always
//     has a generation; a call without one simply sees the MCP half.
//   * **A source that is off is absent, not empty.** No MCP host means no `mcp__`
//     names, and the merge layer then has nothing to offer from that half rather than
//     a half that is silently broken.
//
// What is not here: whose tools these are (the manifest's `toolAccess` decides), the
// rules (the rules port decides), and the prompt an `ask` reaches (the approvals port).
// They travel into the sessions unchanged.

import type { MiniAppPermissionSwitchPort } from './contracts.js';
import type { MiniAppToolAuditPort, MiniAppToolCaller } from './tool-gateway.js';
import { createMiniAppHostToolPort } from './tool-sources.js';
import { createMiniAppConnectorToolSource } from './tool-source-connector.js';
import type { MiniAppConnectorGatewayPort } from './tool-source-connector.js';
import { createMiniAppMcpToolSource } from './tool-source-mcp.js';
import type { MiniAppMcpHostPort } from './tool-source-mcp.js';
import {
  createMiniAppToolSessions,
  type MiniAppToolSessions,
  type MiniAppToolSessionsOptions,
} from './tool-sessions.js';

export interface MiniAppToolHostOptions {
  /** The installed MCP servers the Host serves, read per listing and per call. */
  readonly mcp?: MiniAppMcpHostPort;
  /** The connectors this Host can reach; the account's grants are its only filter. */
  readonly connectorGateway?: MiniAppConnectorGatewayPort;
  /** Whether the installed package declares `toolAccess: ['call']`. */
  readonly declaresToolAccess: (pluginId: string) => boolean | Promise<boolean>;
  readonly permissionSwitches?: MiniAppPermissionSwitchPort;
  readonly permissions?: MiniAppToolSessionsOptions['permissions'];
  readonly approvals?: MiniAppToolSessionsOptions['approvals'];
  readonly audit?: MiniAppToolAuditPort;
}

/** The page channel, as the runtime holds it: one instance for the whole process. */
export function createMiniAppToolHost(options: MiniAppToolHostOptions): MiniAppToolSessions {
  return createMiniAppToolSessions({
    tools: (caller) => toolPort(options, caller),
    declaresToolAccess: options.declaresToolAccess,
    ...(options.permissionSwitches ? { permissionSwitches: options.permissionSwitches } : {}),
    ...(options.permissions ? { permissions: options.permissions } : {}),
    ...(options.approvals ? { approvals: options.approvals } : {}),
    ...(options.audit ? { audit: options.audit } : {}),
  });
}

function toolPort(options: MiniAppToolHostOptions, caller: MiniAppToolCaller) {
  const generation = caller.processGeneration;
  const connectors =
    options.connectorGateway && generation !== undefined
      ? createMiniAppConnectorToolSource({
          gateway: options.connectorGateway,
          caller: { kind: 'host-process', pluginId: caller.pluginId, processGeneration: generation },
        })
      : undefined;
  const mcp = options.mcp ? createMiniAppMcpToolSource({ host: options.mcp }) : undefined;
  return createMiniAppHostToolPort({
    ...(mcp ? { mcp } : {}),
    ...(connectors ? { connectors } : {}),
  });
}
