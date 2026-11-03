import { createLocalMavisCronAdapter } from "@mavis/agent-tools/desktop";
import type { LocalMavisCronAdapter } from "@mavis/agent-tools/desktop";

import type {
  CronDefinitionView,
  CronRunView,
  CronSchedule,
  CronService,
  CronSessionTarget,
} from "../../service/cron/contracts.js";

class CronUnavailableError extends Error {
  readonly code = "CRON_UNAVAILABLE";

  constructor() {
    super("Cron is not available on this runtime host");
    this.name = "CronUnavailableError";
  }
}

export interface V1CronAgentCleanupBridge {
  deleteAgentCronTasks(agentName: string): Promise<void>;
  bind(service: Pick<CronService, "deleteDefinitionsByAgent">): void;
}

/** Stable Agent-cleanup callback passed to v1 before Cron v2 is ready. */
export function createV1CronAgentCleanupBridge(): V1CronAgentCleanupBridge {
  let service: Pick<CronService, "deleteDefinitionsByAgent"> | undefined;
  return {
    async deleteAgentCronTasks(agentName) {
      if (!service) throw new CronUnavailableError();
      service.deleteDefinitionsByAgent(agentName);
    },
    bind(next) {
      if (service) throw new Error("Cron Agent cleanup is already bound");
      service = next;
    },
  };
}

/** The Cron owner members the Mavis tool forwards to. */
export type V1CronAgentToolService = Pick<
  CronService,
  | "listDefinitions"
  | "getDefinition"
  | "createDefinition"
  | "updateDefinition"
  | "deleteDefinition"
  | "triggerManualRun"
  | "listRuns"
>;

export interface V1MavisCronAdapterBridge {
  readonly adapter: LocalMavisCronAdapter;
  bindService(service: V1CronAgentToolService): void;
}

/**
 * The wire shapes the legacy Mavis Cron adapter reads.
 *
 * The adapter predates Cron v2 and speaks its own numeric enums and `*At` field names; the
 * runtime's public contract speaks string kinds and `*AtMs` names. Conversion happens here and
 * nowhere else, so the adapter stays the single place that decides what `cron create` means.
 */
type AdapterScheduleKind = 0 | 1;
type AdapterSessionTargetMode = 0 | 1;
type AdapterRunStatus = 0 | 1 | 2;
type AdapterTriggerSource = 0 | 1;

const AdapterScheduleKind = { Recurring: 0, Once: 1 } as const;
const AdapterSessionTargetMode = { New: 0, SessionId: 1 } as const;
const AdapterRunStatus = { Pending: 0, Delivered: 1, Failed: 2 } as const;
const AdapterTriggerSource = { Manual: 0, Scheduled: 1 } as const;

interface AdapterRun {
  readonly runId: string;
  readonly cronId: string;
  readonly triggerSource: AdapterTriggerSource;
  readonly sessionId?: string;
  readonly status: AdapterRunStatus;
  readonly createdAt: number;
  readonly deliveredAt?: number;
  readonly failedAt?: number;
  readonly errorCode?: string;
  readonly error?: string;
}

interface AdapterDefinition {
  readonly cronId: string;
  readonly name: string;
  readonly agentName: string;
  readonly schedule: {
    readonly kind: AdapterScheduleKind;
    readonly expression?: string;
    readonly timezone?: string;
    readonly runAtMs?: number;
  };
  readonly enabled: boolean;
  readonly prompt: string;
  readonly nextRunAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly consumedAt?: number;
  readonly deletedAt?: number;
  readonly sessionTarget: {
    readonly mode: AdapterSessionTargetMode;
    readonly sessionId?: string;
  };
  readonly project?: string;
  readonly model?: string;
}

function toAdapterSchedule(schedule: CronSchedule): AdapterDefinition["schedule"] {
  if (schedule.kind === "once") {
    return { kind: AdapterScheduleKind.Once, runAtMs: schedule.runAtMs };
  }
  return {
    kind: AdapterScheduleKind.Recurring,
    expression: schedule.expression,
    ...(schedule.timezone === undefined ? {} : { timezone: schedule.timezone }),
  };
}

function toAdapterSessionTarget(
  target: CronSessionTarget,
): AdapterDefinition["sessionTarget"] {
  return target.mode === "new"
    ? { mode: AdapterSessionTargetMode.New }
    : {
        mode: AdapterSessionTargetMode.SessionId,
        ...(target.sessionId === undefined ? {} : { sessionId: target.sessionId }),
      };
}

function toRuntimeSchedule(schedule: AdapterDefinition["schedule"]): CronSchedule {
  if (schedule.kind === AdapterScheduleKind.Once) {
    if (schedule.runAtMs === undefined) {
      throw new Error("one-shot Cron schedule requires runAtMs");
    }
    return { kind: "once", runAtMs: schedule.runAtMs };
  }
  if (schedule.expression === undefined) {
    throw new Error("recurring Cron schedule requires an expression");
  }
  return {
    kind: "recurring",
    expression: schedule.expression,
    ...(schedule.timezone === undefined ? {} : { timezone: schedule.timezone }),
  };
}

function toRuntimeSessionTarget(
  target: AdapterDefinition["sessionTarget"],
): CronSessionTarget {
  return target.mode === AdapterSessionTargetMode.New
    ? { mode: "new" }
    : {
        mode: "sessionId",
        ...(target.sessionId === undefined ? {} : { sessionId: target.sessionId }),
      };
}

function toAdapterDefinition(definition: CronDefinitionView): AdapterDefinition {
  return {
    cronId: definition.cronId,
    name: definition.name,
    agentName: definition.agentName,
    schedule: toAdapterSchedule(definition.schedule),
    enabled: definition.enabled,
    prompt: definition.prompt,
    nextRunAt: definition.nextRunAtMs,
    createdAt: definition.createdAtMs,
    updatedAt: definition.updatedAtMs,
    ...(definition.consumedAtMs === undefined ? {} : { consumedAt: definition.consumedAtMs }),
    ...(definition.deletedAtMs === undefined ? {} : { deletedAt: definition.deletedAtMs }),
    sessionTarget: toAdapterSessionTarget(definition.sessionTarget),
    ...(definition.project ? { project: definition.project } : {}),
    ...(definition.model ? { model: definition.model } : {}),
  };
}

function toAdapterRun(run: CronRunView): AdapterRun {
  return {
    runId: run.runId,
    cronId: run.cronId,
    triggerSource:
      run.triggerSource === "manual"
        ? AdapterTriggerSource.Manual
        : AdapterTriggerSource.Scheduled,
    status:
      run.status === "delivered"
        ? AdapterRunStatus.Delivered
        : run.status === "failed"
          ? AdapterRunStatus.Failed
          : AdapterRunStatus.Pending,
    createdAt: run.createdAtMs,
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    ...(run.deliveredAtMs === undefined ? {} : { deliveredAt: run.deliveredAtMs }),
    ...(run.failedAtMs === undefined ? {} : { failedAt: run.failedAtMs }),
    ...(run.errorCode === undefined ? {} : { errorCode: run.errorCode }),
    ...(run.error === undefined ? {} : { error: run.error }),
  };
}

/** The not-found shape the legacy adapter recognises, instead of a transport status code. */
function cronNotFoundError(cronId: string): Error {
  return Object.assign(new Error(`Cron definition not found: ${cronId}`), {
    status: 404,
    statusCode: 404,
    code: "CRON_NOT_FOUND",
  });
}

/**
 * Stable Mavis Cron adapter passed to v1 before the V2 Cron owner exists.
 *
 * v1 builds the `mavis` tool once, at host construction, and the Cron owner is created later by
 * the service composition; the adapter therefore forwards through this bridge instead of
 * capturing the owner, and answers `CRON_UNAVAILABLE` until the owner is bound.
 */
export function createV1MavisCronAdapterBridge(): V1MavisCronAdapterBridge {
  let service: V1CronAgentToolService | undefined;
  const requireService = (): V1CronAgentToolService => {
    if (!service) throw new CronUnavailableError();
    return service;
  };

  const adapter = createLocalMavisCronAdapter({
    async listModels() {
      // The bridge is bound to the Cron owner, which owns no model catalog; `cron resolve-model`
      // answers `not_found` rather than inventing one.
      return { models: [] };
    },
    async listCronDefinitions(request) {
      const page = await requireService().listDefinitions({
        ...(request.agentName === undefined ? {} : { agentName: request.agentName }),
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        ...(request.includeDeleted === undefined
          ? {}
          : { includeDeleted: request.includeDeleted }),
      });
      return {
        definitions: page.items.map(toAdapterDefinition),
        count: page.items.length,
        hasMore: page.hasMore,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },
    getCronDefinition(request) {
      const definition = requireService().getDefinition(request.cronId);
      if (!definition) throw cronNotFoundError(request.cronId);
      return Promise.resolve({ definition: toAdapterDefinition(definition) });
    },
    async createCronDefinition(request) {
      const definition = await requireService().createDefinition({
        name: request.name,
        agentName: request.agentName,
        schedule: toRuntimeSchedule(request.schedule),
        prompt: request.prompt,
        sessionTarget: toRuntimeSessionTarget(request.sessionTarget),
        ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
        ...(request.project === undefined ? {} : { project: request.project }),
        ...(request.model === undefined ? {} : { model: request.model }),
      });
      return { definition: toAdapterDefinition(definition) };
    },
    async updateCronDefinition(request) {
      const definition = await requireService().updateDefinition({
        cronId: request.cronId,
        ...(request.schedule === undefined
          ? {}
          : { schedule: toRuntimeSchedule(request.schedule) }),
        ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
        ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
        ...(request.sessionTarget === undefined
          ? {}
          : { sessionTarget: toRuntimeSessionTarget(request.sessionTarget) }),
      });
      return { definition: toAdapterDefinition(definition) };
    },
    async deleteCronDefinition(request) {
      await requireService().deleteDefinition({ cronId: request.cronId });
      return { success: true };
    },
    async triggerCronRun(request) {
      const run = await requireService().triggerManualRun(request.cronId);
      return { run: toAdapterRun(run) };
    },
    async listCronRuns(request) {
      const page = await requireService().listRuns({
        cronId: request.cronId,
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
      return {
        runs: page.items.map(toAdapterRun),
        count: page.items.length,
        hasMore: page.hasMore,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },
  });

  return {
    adapter,
    bindService(next) {
      if (service) throw new Error("Cron service is already bound");
      service = next;
    },
  };
}
