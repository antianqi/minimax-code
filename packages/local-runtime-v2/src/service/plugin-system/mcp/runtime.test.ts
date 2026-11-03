import { MINIAPP_LOOPBACK_TOKEN_HEADER } from '@mavis/shared/miniapp-surface';
import { describe, expect, it, vi } from 'vitest';

import type { PluginSnapshotMcpServer } from '../plugin/runtime/snapshot-builder.js';
import { PluginMcpRuntime, type PluginMcpPool } from './runtime.js';

const HOST_LOOPBACK_CREDENTIAL = 'host-issued-loopback-credential';

function managedMiniAppServer(pluginName = 'cutline'): PluginSnapshotMcpServer {
  return {
    pluginName,
    source: 'OFFICIAL',
    packageContentDigest: 'sha256-tree-v1:cutline',
    server: {
      name: pluginName,
      description: 'Cutline editing tools',
      resolvedServer: {
        name: pluginName,
        transport: { type: 'http', url: 'http://127.0.0.1:41234/mcp/cutline' },
        enabled: true,
        timeout: 900_000,
      },
      declaredTools: [],
      configJson: '{}',
    },
    managedIdentity: {
      kind: 'miniapp',
      endpointId: pluginName,
      miniAppGeneration: 'miniapp-generation-1',
      processGeneration: 'process-generation-1',
    },
  };
}

function ordinaryPluginServer(pluginName = 'notes'): PluginSnapshotMcpServer {
  return {
    pluginName,
    source: 'OFFICIAL',
    packageContentDigest: 'sha256-tree-v1:notes',
    server: {
      name: pluginName,
      description: 'Notes tools',
      resolvedServer: {
        name: pluginName,
        transport: { type: 'stdio', command: 'node', args: ['notes-mcp.mjs'] },
        enabled: true,
      },
      declaredTools: [],
      configJson: '{}',
    },
  };
}

function recordingPool(tools: { name: string }[] = [{ name: 'fablecut_status' }]) {
  const listTools = vi.fn(async () =>
    tools.map((tool) => ({
      name: tool.name,
      description: 'Synthetic tool',
      inputSchema: { type: 'object' as const, properties: {} },
    })),
  );
  const callTool = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
  const pool: PluginMcpPool = {
    listTools,
    callTool,
    disconnect: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
  return { pool, listTools, callTool };
}

function hostCredentialResolver() {
  return vi.fn(() => ({
    headers: { [MINIAPP_LOOPBACK_TOKEN_HEADER]: HOST_LOOPBACK_CREDENTIAL },
  }));
}

describe('The Host reaches a Mini App managed MCP server with its own loopback credential', () => {
  it('presents the credential when it lists the managed server tools', async () => {
    const { pool, listTools } = recordingPool();
    const runtime = new PluginMcpRuntime({
      pool,
      resolveMiniAppTokenOverrides: hostCredentialResolver(),
    });

    const result = await runtime.reconcile([managedMiniAppServer()], {
      inventoryMode: 'discover-managed',
    });

    expect(result.failedServerCount).toBe(0);
    expect(result.runtimeTools.map((tool) => tool.def.name)).toEqual([
      'mcp__cutline__fablecut_status',
    ]);
    expect(listTools).toHaveBeenCalledTimes(1);
    const overrides = listTools.mock.calls[0]?.[1];
    expect(overrides?.headers?.[MINIAPP_LOOPBACK_TOKEN_HEADER]).toBe(HOST_LOOPBACK_CREDENTIAL);
  });

  it('presents the credential when it calls a managed server tool', async () => {
    const { pool, callTool } = recordingPool();
    const runtime = new PluginMcpRuntime({
      pool,
      resolveMiniAppTokenOverrides: hostCredentialResolver(),
    });
    const result = await runtime.reconcile([managedMiniAppServer()], {
      inventoryMode: 'discover-managed',
    });

    const tool = result.runtimeTools[0]!;
    await tool.impl.execute({ sessionId: 's', turnId: 't' }, {});

    expect(callTool).toHaveBeenCalledTimes(1);
    const overrides = callTool.mock.calls[0]?.[3];
    expect(overrides?.headers?.[MINIAPP_LOOPBACK_TOKEN_HEADER]).toBe(HOST_LOOPBACK_CREDENTIAL);
  });

  it('never asks for a Mini App credential on behalf of an ordinary plugin server', async () => {
    const { pool, listTools } = recordingPool();
    const resolveMiniAppTokenOverrides = hostCredentialResolver();
    const runtime = new PluginMcpRuntime({ pool, resolveMiniAppTokenOverrides });

    await runtime.reconcile([ordinaryPluginServer()], { inventoryMode: 'discover' });

    expect(resolveMiniAppTokenOverrides).not.toHaveBeenCalled();
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(listTools.mock.calls[0]?.[1]).toBeUndefined();
  });
});
