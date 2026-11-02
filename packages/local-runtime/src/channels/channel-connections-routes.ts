// The 接入 IM Connection routes.
//
// Desktop's 接入 IM pane is driven by Channel **Connections**, not by the per-platform binding
// stores: `GET /channel/connections` lists one row per bot whether or not it is bound, and each row
// carries the `state` that decides which card shape Desktop draws (`bound` → 解除连接, anything
// else → the unbound copy and the QR). Reading the platform status routes instead answers a
// different question — "which transport clients are bound" — and a bot waiting for its QR scan is
// then reported as bound. This module is the missing route, ported from the runtime's own v2
// dispatcher (`channel-system/delivery/legacy-http/dispatch/connections-routes`) against the v1
// store and adapters this package owns.
//
// The store already owns every transition, so each handler is a thin call plus the platform
// compensation Desktop performs around it:
//
//   * `POST connections/prepare`   — create the bot the create flow is adding (`store.prepare`).
//   * `DELETE connections/<id>`    — 删除Bot: remove the Connection, first tearing down the platform
//                                    side (a bound binding is unbound, an authorization cancelled).
//   * `DELETE connections/<id>/binding` — 解除连接: unbind the platform, keep the Connection.
//   * `POST connections/<id>/authorization/cancel` — cancel the pending scan.
//
// A refusal is the runtime's own: `LocalImConnectionError` and the agent-contract errors keep their
// status and code, because the browser shows them next to the control that caused them.
import { LocalAgentContractError, validateAgentName } from '../agent/contract.js';
import { normalizePrimaryAgentResolutionConflict } from '../api/host-channel-family-gate.js';
import { json, notFound, readFirstString, readJsonBody } from '../api/http-helpers.js';
import type { LocalFeishuChannelApi } from './feishu.js';
import { DEFAULT_PROJECT_KEY } from '../project/canonical-workspace.js';
import type { LocalChannelBridgeInfra } from './infra.js';
import {
  LocalImConnectionError,
  type LocalImConnectionDeletionSnapshot,
  type LocalImConnectionView,
} from './im-connection-store.js';
import type { ChannelPlatform } from './route-api.js';
import type { LocalTelegramChannelApi } from './telegram.js';
import type { LocalWeChatChannelApi } from './wechat.js';

export interface ChannelConnectionsRouteInput {
  readonly request: Request;
  readonly method: string;
  readonly parts: string[];
  readonly url: URL;
  readonly infra: LocalChannelBridgeInfra;
  readonly feishu?: LocalFeishuChannelApi;
  readonly telegram?: LocalTelegramChannelApi;
  readonly wechat?: LocalWeChatChannelApi;
}

/** The refusal a host whose composition carries no Connection store answers with. */
export const LOCAL_CHANNEL_CONNECTIONS_UNAVAILABLE =
  'Channel Connections require the Local Runtime V2 Conversation composition.';

export async function routeLocalChannelConnectionsApi(
  input: ChannelConnectionsRouteInput,
): Promise<Response | undefined> {
  const tail = input.parts.slice(1);
  if (tail[0] !== 'connections') return undefined;
  const store = input.infra.imConnectionStore;
  if (!store) {
    return json(
      { error: LOCAL_CHANNEL_CONNECTIONS_UNAVAILABLE, code: 'CHANNEL_CONNECTIONS_UNAVAILABLE' },
      { status: 503 },
    );
  }
  try {
    if (input.method === 'GET' && tail.length === 1) {
      const rawFilter = input.url.searchParams.get('channel_filter');
      const filter = rawFilter === null ? undefined : readChannel(rawFilter);
      if (rawFilter !== null && filter === undefined) {
        return json({ error: 'channel_filter is invalid', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const views = await store.listViews(filter);
      return json({ connections: await serializeViews(input, views) });
    }
    if (input.method === 'POST' && tail.length === 2 && tail[1] === 'prepare') {
      const body = await readJsonBody(input.request);
      const channel = readChannel(body.channel);
      if (!channel) {
        return json(
          { error: 'channel is required', code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      const agentName = await resolveWriteAgent(
        input.infra,
        readFirstString(body, ['agentName', 'agent_name']) ?? 'mavis',
        channel,
      );
      const projectKey = readProjectKey(body);
      if (projectKey === undefined) {
        return json({ error: 'projectKey is invalid', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const connection = await store.prepare({
        agentName,
        channel,
        projectKey,
        resolvedProjectKey: projectKey ?? DEFAULT_PROJECT_KEY,
      });
      const view = await viewFor(input, connection.connectionId);
      return json({ connection: await serializeView(input, view) });
    }
    const connectionId = tail[1];
    if (!connectionId) return notFound(`/channel-bridge/${tail.join('/')}`);
    if (input.method === 'DELETE' && tail.length === 2) {
      const deleted = await store.deleteConnection(
        connectionId,
        async (snapshot) => {
          await releasePlatform(input, snapshot);
        },
      );
      return json({ deleted });
    }
    if (input.method === 'DELETE' && tail.length === 3 && tail[2] === 'binding') {
      const view = await requireView(input, connectionId);
      if (view.binding) await unbindPlatform(input, view.binding.channel, view.connection.agentName);
      const deleted = await store.deleteBinding(connectionId);
      const after = await viewFor(input, connectionId);
      return json({ deleted, connection: await serializeView(input, after) });
    }
    if (
      input.method === 'POST' &&
      tail.length === 4 &&
      tail[2] === 'authorization' &&
      tail[3] === 'cancel'
    ) {
      const view = await requireView(input, connectionId);
      const authorization = store.getAuthorization(connectionId);
      if (authorization) {
        await unbindPlatform(input, authorization.channel, view.connection.agentName);
      }
      await store.cancelAuthorization(connectionId);
      const after = await viewFor(input, connectionId);
      return json({ connection: await serializeView(input, after) });
    }
    return notFound(`/channel-bridge/${tail.join('/')}`);
  } catch (error) {
    if (error instanceof LocalImConnectionError || error instanceof LocalAgentContractError) {
      return json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}

function readChannel(value: unknown): ChannelPlatform | undefined {
  return value === 'feishu' || value === 'telegram' || value === 'wechat' ? value : undefined;
}

/** Undefined means malformed; null means the user explicitly picked no project. */
function readProjectKey(body: Record<string, unknown>): string | null | undefined {
  const direct = body.projectKey ?? body.project_key;
  if (direct === null) return null;
  if (direct === undefined) return null;
  if (typeof direct !== 'string') return undefined;
  return direct.trim() || null;
}

async function resolveWriteAgent(
  infra: LocalChannelBridgeInfra,
  requestedName: string,
  platform: ChannelPlatform,
): Promise<string> {
  if (!infra.resolveAgentWriteTarget) {
    throw new LocalAgentContractError(
      503,
      'Agent write resolver is unavailable',
      'AGENT_RESOLVER_UNAVAILABLE',
    );
  }
  try {
    return await infra.resolveAgentWriteTarget(requestedName);
  } catch (err) {
    if (err instanceof LocalAgentContractError && err.code === 'UNKNOWN_AGENT_NAME') {
      return validateAgentName(requestedName);
    }
    const primaryConflict = normalizePrimaryAgentResolutionConflict(err, {
      platform,
      canonicalAgentName: 'mavis',
      agentNames: ['mavis', 'main'],
    });
    if (primaryConflict) throw primaryConflict;
    throw err;
  }
}

async function requireView(
  input: ChannelConnectionsRouteInput,
  connectionId: string,
): Promise<LocalImConnectionView> {
  const store = input.infra.imConnectionStore!;
  const view = (await store.listViews()).find(
    (candidate) => candidate.connection.connectionId === connectionId,
  );
  if (!view) {
    throw new LocalImConnectionError(
      404,
      'CHANNEL_CONNECTION_NOT_FOUND',
      'Channel Connection not found.',
    );
  }
  return view;
}

async function viewFor(
  input: ChannelConnectionsRouteInput,
  connectionId: string,
): Promise<LocalImConnectionView> {
  return requireView(input, connectionId);
}

/**
 * Tears down whatever the Connection held on its platform: a bound binding is unbound, a pending
 * authorization is cancelled. Both are the platform's own unbind — this runtime has no separate
 * cancel route per platform, and an unbind of an unconfirmed binding is idempotent.
 */
async function releasePlatform(
  input: ChannelConnectionsRouteInput,
  snapshot: LocalImConnectionDeletionSnapshot,
): Promise<void> {
  const channel = snapshot.binding?.channel ?? snapshot.authorization?.channel;
  if (!channel) return;
  await unbindPlatform(input, channel, snapshot.connection.agentName);
}

async function unbindPlatform(
  input: ChannelConnectionsRouteInput,
  channel: ChannelPlatform,
  agentName: string,
): Promise<void> {
  const api = channel === 'telegram' ? input.telegram : channel === 'wechat' ? input.wechat : input.feishu;
  if (!api) {
    throw new LocalImConnectionError(
      503,
      'CHANNEL_PLATFORM_UNBIND_UNAVAILABLE',
      'The platform binding cannot be disconnected because its adapter is unavailable.',
    );
  }
  const response = await api.unbind(
    new Request(`http://local-runtime.test/channel-bridge/${channel}/unbind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentName }),
    }),
  );
  if (!response.ok) {
    throw new LocalImConnectionError(
      response.status,
      'CHANNEL_PLATFORM_UNBIND_FAILED',
      'The platform binding could not be disconnected.',
    );
  }
}

async function serializeViews(
  input: ChannelConnectionsRouteInput,
  views: readonly LocalImConnectionView[],
): Promise<unknown[]> {
  const labels = await feishuLabels(input, views);
  return views.map((view) => serializeConnectionView(view, labels));
}

async function serializeView(
  input: ChannelConnectionsRouteInput,
  view: LocalImConnectionView,
): Promise<unknown> {
  const labels = await feishuLabels(input, [view]);
  return serializeConnectionView(view, labels);
}

/**
 * The Feishu bot's display name, which Desktop shows as the row's name.
 *
 * Read from the adapter's own status snapshot, and only when a Feishu binding is in play: the other
 * platforms carry their name in the binding itself. A failed snapshot only drops the label — the
 * list must still render.
 */
async function feishuLabels(
  input: ChannelConnectionsRouteInput,
  views: readonly LocalImConnectionView[],
): Promise<ReadonlyMap<string, string>> {
  const labels = new Map<string, string>();
  const names = views
    .map((view) => view.binding)
    .filter((binding) => binding?.channel === 'feishu')
    .map((binding) => binding!.clientName);
  if (names.length === 0 || !input.feishu) return labels;
  try {
    const clients = await input.feishu.statusClients();
    for (const name of names) {
      const client = clients[name];
      if (!client || typeof client !== 'object') continue;
      const botName = (client as { botName?: unknown }).botName;
      if (typeof botName === 'string' && botName.trim()) labels.set(name, botName.trim());
    }
  } catch {
    // A live status read is an enrichment, not a precondition for listing the bots.
  }
  return labels;
}

function serializeConnectionView(
  view: LocalImConnectionView,
  labels: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const { connection, binding } = view;
  const label = binding ? labels.get(binding.clientName) : undefined;
  return {
    connectionId: connection.connectionId,
    channel: connection.channel,
    agentName: connection.agentName,
    projectKey: connection.projectKey,
    state: view.state,
    ...(binding
      ? {
          binding: {
            bindingId: binding.bindingId,
            channel: binding.channel,
            externalId: binding.clientName,
            ...(label === undefined ? {} : { label }),
            ...(binding.currentSessionId === undefined
              ? {}
              : { currentSessionId: binding.currentSessionId }),
            createdAt: binding.createdAt,
            updatedAt: binding.updatedAt,
          },
        }
      : {}),
    ...(view.errorCode === undefined ? {} : { errorCode: view.errorCode }),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}
