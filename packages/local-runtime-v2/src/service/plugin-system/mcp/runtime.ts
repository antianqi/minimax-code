import type {
  AgentHostTurnCapabilityView as DesktopTurnCapabilityView,
  AgentHostTurnRuntimeToolBinding as DesktopTurnRuntimeToolBinding,
} from '../../turn-system/index.js';
import {
  McpNameRegistry,
  pluginMcpNameKey,
  McpConnectionPool,
  type McpConnectionPoolOptions,
  type McpConnectionTokenOverrides,
  type McpPoolMetrics,
  type McpRuntimeLogger,
  type McpToolCallResult,
  type McpToolInfo,
} from '@mavis/mcp';

import type {
  PluginSnapshotDiagnostic,
  PluginSnapshotMcpServer,
} from '../plugin/runtime/snapshot-builder.js';

type DesktopRuntimeTool = DesktopTurnCapabilityView['runtimeTools'][number];

const LIST_TOOLS_CONCURRENCY = 4;
const MAX_TOOLS_PER_SERVER = 128;
const MAX_TOOLS_PER_SNAPSHOT = 256;

export interface PluginMcpPool {
  listTools(
    serverName: string,
    tokenOverrides?: McpConnectionTokenOverrides,
  ): Promise<McpToolInfo[]>;
  callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    tokenOverrides?: McpConnectionTokenOverrides,
    options?: { signal?: AbortSignal },
  ): Promise<McpToolCallResult>;
  disconnect(serverName: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface PluginMcpRuntimePort {
  reconcile(
    entries: readonly PluginSnapshotMcpServer[],
    options?: PluginMcpReconcileOptions,
  ): Promise<PluginMcpReconcileResult>;
  disconnectServers(serverNames: readonly string[]): Promise<void>;
  close(): Promise<void>;
  /** Export only successful immutable tools/list inventories for a new generation. */
  exportInventory?(): readonly PluginMcpInventorySeed[];
  /** Seed a fresh generation before reconciling its server declarations. */
  importInventory?(seed: readonly PluginMcpInventorySeed[]): void;
  /**
   * The servers a Mini App page may reach, by the name the package declared.
   *
   * The page channel names tools `mcp__<server>__<tool>` from these names, so it reads
   * them here rather than from the turn runtime's name allocation: a page has its own
   * flat namespace and must not inherit a collision suffix meant for the Agent path.
   */
  pageServers?(): readonly string[];
  /** One served server's tools, as its own `tools/list` answered them. */
  listPageTools?(
    serverName: string,
  ): Promise<readonly { readonly name: string; readonly description?: string }[]>;
  /** One tool of one served server, called through the same pool the Agent path uses. */
  callPageTool?(input: {
    readonly serverName: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly signal?: AbortSignal;
  }): Promise<McpToolCallResult>;
}

export interface PluginMcpInventorySeed {
  readonly serverName: string;
  readonly lifecycleKey: string;
  readonly tools: readonly McpToolInfo[];
}

export interface PluginMcpReconcileOptions {
  /** Reuse the last inventory for unchanged servers during a targeted local mutation. */
  readonly reuseExistingInventory?: boolean;
  /**
   * Choose which inventories may perform MCP network I/O. Managed discovery is used by
   * publication participants that must verify rewritten Host-owned endpoints without
   * synchronously probing unrelated ordinary Plugin MCP servers.
   */
  readonly inventoryMode?: 'cached-only' | 'discover-managed' | 'discover';
}

export interface PluginMcpRuntimeOptions {
  readonly names?: McpNameRegistry;
  readonly pool?: PluginMcpPool;
  readonly logger?: McpRuntimeLogger;
  readonly metrics?: McpPoolMetrics;
  readonly poolOptions?: Pick<McpConnectionPoolOptions, 'idleTimeoutMs' | 'maxConcurrency'>;
  /**
   * Per-connection overrides for a server the Host published as a Mini App
   * managed endpoint. The credential belongs to the Host that issued it, so the
   * runtime asks for it only for a managed server and never for an ordinary
   * plugin server.
   */
  readonly resolveMiniAppTokenOverrides?: (
    server: PluginSnapshotMcpServer,
  ) => McpConnectionTokenOverrides | undefined;
  readonly listToolsTimeoutMs?: number;
  readonly disconnectTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

export interface PluginMcpReconcileResult {
  readonly runtimeTools: readonly DesktopRuntimeTool[];
  readonly runtimeToolBindings?: readonly DesktopTurnRuntimeToolBinding[];
  readonly diagnostics: readonly PluginSnapshotDiagnostic[];
  readonly failedServerCount: number;
}

interface CachedMcpInventory {
  readonly lifecycleKey: string;
  readonly tools: readonly McpToolInfo[];
  readonly failed: boolean;
}

/**
 * Desktop Plugin MCP owner. Its pool and lookup are deliberately separate
 * from v1 LocalMcpService, whose connections belong to the user's mcp.json.
 */
export class PluginMcpRuntime implements PluginMcpRuntimePort {
  private readonly servers = new Map<string, PluginSnapshotMcpServer>();
  private readonly lifecycleKeys = new Map<string, string>();
  private readonly inventories = new Map<string, CachedMcpInventory>();
  private readonly pool: PluginMcpPool;
  private readonly logger: McpRuntimeLogger;
  private readonly metrics: McpPoolMetrics | undefined;
  private readonly listToolsTimeoutMs: number;
  private readonly disconnectTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private closed = false;
  private readonly names: McpNameRegistry;
  private readonly resolveMiniAppTokenOverrides:
    | ((server: PluginSnapshotMcpServer) => McpConnectionTokenOverrides | undefined)
    | undefined;

  constructor(options: PluginMcpRuntimeOptions = {}) {
    this.names = options.names ?? new McpNameRegistry();
    this.resolveMiniAppTokenOverrides = options.resolveMiniAppTokenOverrides;
    this.logger = options.logger ?? NOOP_LOGGER;
    this.metrics = options.metrics;
    this.listToolsTimeoutMs = options.listToolsTimeoutMs ?? 15_000;
    this.disconnectTimeoutMs = options.disconnectTimeoutMs ?? 5_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    this.pool =
      options.pool ??
      new McpConnectionPool(
        {
          getResolvedServer: (serverName) =>
            this.servers.get(serverName)?.server.resolvedServer ?? null,
        },
        {
          ...options.poolOptions,
          logger: this.logger,
          ...(options.metrics ? { metrics: options.metrics } : {}),
        },
      );
  }

  async reconcile(
    entries: readonly PluginSnapshotMcpServer[],
    options: PluginMcpReconcileOptions = {},
  ): Promise<PluginMcpReconcileResult> {
    if (this.closed) throw new Error('Plugin MCP runtime is closed');
    this.names.assignServers(
      entries.map((entry) => ({
        key: pluginMcpNameKey(entry.source, entry.pluginName, entry.server.name),
        name: entry.server.name,
      })),
    );
    const inventoryMode = options.inventoryMode ?? 'discover';
    if (inventoryMode !== 'discover') this.retainExactInventories(entries);
    else await this.disconnectStaleServers(entries);
    this.replaceLookup(entries);

    const runtimeTools: DesktopRuntimeTool[] = [];
    const runtimeToolBindings: DesktopTurnRuntimeToolBinding[] = [];
    const diagnostics: PluginSnapshotDiagnostic[] = [];
    const toolNames = new Set<string>();
    let failedServerCount = 0;
    const inventories = await mapBounded(entries, LIST_TOOLS_CONCURRENCY, async (entry) =>
      shouldDiscoverInventory(entry, inventoryMode)
        ? this.resolveInventory(entry, options.reuseExistingInventory === true)
        : this.resolveCachedInventory(entry),
    );
    await this.enforceInventoryLimits(entries, inventories, inventoryMode);

    for (const [index, entry] of entries.entries()) {
      const inventory = inventories[index];
      if (!inventory || inventory.failed) {
        failedServerCount += 1;
        diagnostics.push(
          freeze({
            code: shouldDiscoverInventory(entry, inventoryMode)
              ? 'MCP_SERVER_LIST_FAILED'
              : 'MCP_SERVER_WARMING',
            pluginName: entry.pluginName,
            capabilityName: entry.server.name,
          }),
        );
        continue;
      }
      for (const { tool, nativeName } of this.assignToolNames(
        entry,
        inventory.tools,
        diagnostics,
      )) {
        const key = collisionKey(nativeName);
        if (toolNames.has(key)) {
          diagnostics.push(
            freeze({
              code: 'MCP_TOOL_NAME_CONFLICT',
              pluginName: entry.pluginName,
              capabilityName: tool.name,
            }),
          );
          continue;
        }
        toolNames.add(key);
        const runtimeTool = this.runtimeTool(entry, tool, nativeName);
        runtimeTools.push(runtimeTool);
        runtimeToolBindings.push(
          freeze({
            kind: 'mcp',
            source: entry.server.name,
            pluginName: entry.pluginName,
            tool: runtimeTool,
          }),
        );
      }
    }

    return freeze({
      runtimeTools: freeze(runtimeTools),
      runtimeToolBindings: freeze(runtimeToolBindings),
      diagnostics: freeze(diagnostics),
      failedServerCount,
    });
  }

  private assignToolNames(
    entry: PluginSnapshotMcpServer,
    tools: readonly McpToolInfo[],
    diagnostics: PluginSnapshotDiagnostic[],
  ): { readonly tool: McpToolInfo; readonly nativeName: string }[] {
    const allocated = this.names.assignTools(
      pluginMcpNameKey(entry.source, entry.pluginName, entry.server.name),
      tools.map((tool) => tool.name),
    );
    return tools.flatMap((tool) => {
      const nativeName = allocated.names.get(tool.name);
      if (nativeName) return [{ tool, nativeName }];
      diagnostics.push({
        code: 'MCP_TOOL_NAME_INVALID',
        pluginName: entry.pluginName,
        capabilityName: tool.name,
      });
      return [];
    });
  }

  /**
   * The served servers, by declared name.
   *
   * Two packages may declare one server name; the page sees one name, and the first
   * registration answers for it — the same "first one wins" rule the page's tool list
   * follows when two sources claim a name.
   */
  pageServers(): readonly string[] {
    const names = new Set<string>();
    for (const entry of this.servers.values()) names.add(entry.server.name);
    return [...names];
  }

  async listPageTools(
    serverName: string,
  ): Promise<readonly { readonly name: string; readonly description?: string }[]> {
    const entry = this.pageEntry(serverName);
    // A server this runtime does not serve has no tools, not an error: the page's
    // adapter already refuses a server that stopped being served.
    if (!entry) return [];
    const inventory = await this.resolveInventory(entry, true);
    if (inventory.failed) return [];
    return inventory.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
    }));
  }

  async callPageTool(input: {
    readonly serverName: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly signal?: AbortSignal;
  }): Promise<McpToolCallResult> {
    const entry = this.pageEntry(input.serverName);
    if (!entry) throw new Error(`Plugin MCP server is not served: ${input.serverName}`);
    return this.pool.callTool(
      poolName(entry),
      input.name,
      toRecord(input.arguments),
      this.miniAppTokenOverrides(entry),
      input.signal ? { signal: input.signal } : undefined,
    );
  }

  private pageEntry(serverName: string): PluginSnapshotMcpServer | undefined {
    for (const entry of this.servers.values()) {
      if (entry.server.name === serverName) return entry;
    }
    return undefined;
  }

  exportInventory(): readonly PluginMcpInventorySeed[] {
    if (this.closed) return [];
    return freeze(
      [...this.inventories.entries()].flatMap(([serverName, inventory]) =>
        inventory.failed
          ? []
          : [
              freeze({
                serverName,
                lifecycleKey: inventory.lifecycleKey,
                tools: freeze([...inventory.tools]),
              }),
            ],
      ),
    );
  }

  importInventory(seed: readonly PluginMcpInventorySeed[]): void {
    if (this.closed || this.servers.size > 0 || this.inventories.size > 0) return;
    for (const item of seed) {
      this.lifecycleKeys.set(item.serverName, item.lifecycleKey);
      this.inventories.set(
        item.serverName,
        freeze({
          lifecycleKey: item.lifecycleKey,
          tools: freeze([...item.tools]),
          failed: false,
        }),
      );
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.servers.clear();
    this.lifecycleKeys.clear();
    this.inventories.clear();
    await ignoreFailure(
      withTimeout(
        this.pool.shutdown(),
        this.shutdownTimeoutMs,
        'Plugin MCP runtime shutdown timed out',
      ),
    );
  }

  async disconnectServers(serverNames: readonly string[]): Promise<void> {
    await Promise.allSettled(
      [...new Set(serverNames)].map((serverName) => this.disconnectBounded(serverName)),
    );
  }

  private async disconnectBounded(serverName: string): Promise<void> {
    await ignoreFailure(
      withTimeout(
        this.pool.disconnect(serverName),
        this.disconnectTimeoutMs,
        `Plugin MCP disconnect timed out for ${serverName}`,
      ),
    );
  }

  private async disconnectStaleServers(entries: readonly PluginSnapshotMcpServer[]): Promise<void> {
    const nextKeys = new Map(entries.map((entry) => [poolName(entry), lifecycleKey(entry)]));
    const stale = [...this.lifecycleKeys].flatMap(([serverName, priorKey]) =>
      nextKeys.get(serverName) === priorKey ? [] : [serverName],
    );
    await this.disconnectServers(stale);
    for (const serverName of stale) this.inventories.delete(serverName);
  }

  private retainExactInventories(entries: readonly PluginSnapshotMcpServer[]): void {
    const nextKeys = new Map(entries.map((entry) => [poolName(entry), lifecycleKey(entry)]));
    for (const [serverName, inventory] of this.inventories) {
      if (nextKeys.get(serverName) !== inventory.lifecycleKey || inventory.failed) {
        this.inventories.delete(serverName);
      }
    }
  }

  private resolveCachedInventory(entry: PluginSnapshotMcpServer): CachedMcpInventory {
    const key = lifecycleKey(entry);
    const existing = this.inventories.get(poolName(entry));
    if (existing?.lifecycleKey === key && !existing.failed) return existing;
    return freeze({ lifecycleKey: key, tools: freeze([] as McpToolInfo[]), failed: true });
  }

  private async resolveInventory(
    entry: PluginSnapshotMcpServer,
    reuseExisting: boolean,
  ): Promise<CachedMcpInventory> {
    const key = lifecycleKey(entry);
    const existing = this.inventories.get(poolName(entry));
    if (reuseExisting && existing?.lifecycleKey === key) return existing;

    try {
      const tools = await withTimeout(
        this.pool.listTools(poolName(entry), this.miniAppTokenOverrides(entry)),
        this.listToolsTimeoutMs,
        `Plugin MCP tools/list timed out for ${entry.server.name}`,
      );
      if (tools.length > MAX_TOOLS_PER_SERVER) {
        throw new Error(
          `Plugin MCP server ${entry.server.name} returned more than ${MAX_TOOLS_PER_SERVER} tools`,
        );
      }
      this.metrics?.incr('plugin_mcp_list_total', { status: 'ok' });
      const inventory = freeze({ lifecycleKey: key, tools: freeze([...tools]), failed: false });
      this.inventories.set(poolName(entry), inventory);
      return inventory;
    } catch (error) {
      await this.disconnectBounded(poolName(entry));
      this.metrics?.incr('plugin_mcp_list_total', { status: 'error' });
      this.logger.warn('Plugin MCP tools/list failed', {
        pluginName: entry.pluginName,
        source: entry.source,
        serverName: entry.server.name,
        errorType: errorType(error),
      });
      const inventory = freeze({
        lifecycleKey: key,
        tools: freeze([] as McpToolInfo[]),
        failed: true,
      });
      this.inventories.set(poolName(entry), inventory);
      return inventory;
    }
  }

  /**
   * The overrides a managed server's connection must carry. A server the Host
   * did not publish as managed never receives a Mini App credential.
   */
  private miniAppTokenOverrides(
    entry: PluginSnapshotMcpServer,
  ): McpConnectionTokenOverrides | undefined {
    if (!entry.managedIdentity) return undefined;
    return this.resolveMiniAppTokenOverrides?.(entry);
  }

  private async rejectInventory(
    entry: PluginSnapshotMcpServer,
    key: string,
    reason: string,
  ): Promise<CachedMcpInventory> {
    await this.disconnectBounded(poolName(entry));
    this.metrics?.incr('plugin_mcp_list_total', { status: 'limit' });
    this.logger.warn('Plugin MCP tools/list inventory rejected', {
      pluginName: entry.pluginName,
      source: entry.source,
      serverName: entry.server.name,
      reason,
    });
    const inventory = freeze({
      lifecycleKey: key,
      tools: freeze([] as McpToolInfo[]),
      failed: true,
    });
    this.inventories.set(poolName(entry), inventory);
    return inventory;
  }

  private async enforceInventoryLimits(
    entries: readonly PluginSnapshotMcpServer[],
    inventories: CachedMcpInventory[],
    inventoryMode: NonNullable<PluginMcpReconcileOptions['inventoryMode']>,
  ): Promise<void> {
    let acceptedToolCount = 0;
    for (const [index, entry] of entries.entries()) {
      const inventory = inventories[index];
      if (!inventory || inventory.failed) continue;
      const exceedsServer = inventory.tools.length > MAX_TOOLS_PER_SERVER;
      const exceedsSnapshot = acceptedToolCount + inventory.tools.length > MAX_TOOLS_PER_SNAPSHOT;
      if (exceedsServer || exceedsSnapshot) {
        const reason = exceedsServer
          ? `Plugin MCP server returned more than ${MAX_TOOLS_PER_SERVER} tools`
          : `Plugin MCP snapshot exceeds ${MAX_TOOLS_PER_SNAPSHOT} tools`;
        inventories[index] = shouldDiscoverInventory(entry, inventoryMode)
          ? await this.rejectInventory(entry, inventory.lifecycleKey, reason)
          : this.rejectCachedInventory(entry, inventory.lifecycleKey, reason);
        continue;
      }
      acceptedToolCount += inventory.tools.length;
    }
  }

  private rejectCachedInventory(
    entry: PluginSnapshotMcpServer,
    key: string,
    reason: string,
  ): CachedMcpInventory {
    this.metrics?.incr('plugin_mcp_list_total', { status: 'limit' });
    this.logger.warn('Plugin MCP cached inventory rejected', {
      pluginName: entry.pluginName,
      source: entry.source,
      serverName: entry.server.name,
      reason,
    });
    this.inventories.delete(poolName(entry));
    return freeze({ lifecycleKey: key, tools: freeze([] as McpToolInfo[]), failed: true });
  }

  private replaceLookup(entries: readonly PluginSnapshotMcpServer[]): void {
    this.servers.clear();
    this.lifecycleKeys.clear();
    for (const entry of entries) {
      this.servers.set(poolName(entry), entry);
      this.lifecycleKeys.set(poolName(entry), lifecycleKey(entry));
    }
  }

  private runtimeTool(
    entry: PluginSnapshotMcpServer,
    tool: McpToolInfo,
    nativeName: string,
  ): DesktopRuntimeTool {
    const def: DesktopRuntimeTool['def'] = freeze({
      name: nativeName,
      description:
        tool.description ??
        `Call MCP tool ${tool.name} from Plugin ${entry.pluginName} server ${entry.server.name}.`,
      schema: freeze({ ...tool.inputSchema }) as DesktopRuntimeTool['def']['schema'],
    });
    return freeze({
      def,
      impl: freeze({
        execute: async (_context, input, signal) => {
          const result = await this.pool.callTool(
            poolName(entry),
            tool.name,
            toRecord(input),
            this.miniAppTokenOverrides(entry),
            signal ? { signal } : undefined,
          );
          const text = mcpContentToText(result);
          const content = toToolResultContent(result, text);
          return {
            tool_name: nativeName,
            text,
            content,
            ...(result.isError === true ? { isError: true } : {}),
            details: {
              mcp: result,
              server: entry.server.name,
              tool: tool.name,
              plugin: entry.pluginName,
            },
            output: { mcp: result },
          };
        },
      }),
      source: 'configured',
    });
  }
}

function shouldDiscoverInventory(
  entry: PluginSnapshotMcpServer,
  inventoryMode: NonNullable<PluginMcpReconcileOptions['inventoryMode']>,
): boolean {
  return (
    inventoryMode === 'discover' ||
    (inventoryMode === 'discover-managed' && entry.managedIdentity !== undefined)
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ignoreFailure(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // Shutdown and stale-generation cleanup are bounded best-effort operations.
  }
}

async function mapBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function lifecycleKey(entry: PluginSnapshotMcpServer): string {
  return JSON.stringify({
    pluginName: entry.pluginName,
    source: entry.source,
    server: entry.server.resolvedServer,
    ...(entry.managedIdentity ? { managedIdentity: entry.managedIdentity } : {}),
    ...(entry.server.resolvedServer.transport.type === 'stdio'
      ? { packageContentDigest: entry.packageContentDigest }
      : {}),
  });
}

function collisionKey(value: string): string {
  return value.startsWith('mcp__')
    ? value
    : value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toToolResultContent(
  result: McpToolCallResult,
  fallbackText: string,
): Awaited<ReturnType<DesktopRuntimeTool['impl']['execute']>>['content'] {
  const content = result.content.map((item) => {
    if (item.type === 'text') return { type: 'text' as const, text: item.text ?? '' };
    if (item.type === 'image' && item.data && item.mimeType) {
      return { type: 'image' as const, data: item.data, mimeType: item.mimeType };
    }
    return { type: 'text' as const, text: `[${item.type}]` };
  });
  return content.length > 0 ? content : [{ type: 'text', text: fallbackText }];
}

function mcpContentToText(result: McpToolCallResult): string {
  const text = result.content
    .map((item) => (item.type === 'text' ? (item.text ?? '') : `[${item.type}]`))
    .filter(Boolean)
    .join('\n');
  return text || (result.isError ? 'MCP tool returned an error.' : 'MCP tool returned no content.');
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

const NOOP_LOGGER: McpRuntimeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function poolName(entry: PluginSnapshotMcpServer): string {
  return pluginMcpNameKey(entry.source, entry.pluginName, entry.server.name);
}
