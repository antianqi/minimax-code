import { describe, expect, it } from "vitest";

import type {
  CronDefinitionView,
  CronRunView,
} from "../../service/cron/contracts.js";
import {
  createV1MavisCronAdapterBridge,
  type V1CronAgentToolService,
} from "./cron.js";

function definition(overrides: Partial<CronDefinitionView> = {}): CronDefinitionView {
  return {
    cronId: "cron-1",
    name: "count-projects",
    agentName: "mavis",
    schedule: {
      kind: "recurring",
      expression: "0 9 * * *",
      timezone: "Asia/Shanghai",
    },
    enabled: true,
    armed: true,
    prompt: "数一下项目数量",
    sessionTarget: { mode: "new" },
    project: null,
    model: null,
    nextRunAtMs: 1_800_000_000_000,
    createdAtMs: 1_799_000_000_000,
    updatedAtMs: 1_799_500_000_000,
    ...overrides,
  };
}

function run(overrides: Partial<CronRunView> = {}): CronRunView {
  return {
    runId: "run-1",
    cronId: "cron-1",
    triggerSource: "manual",
    status: "delivered",
    sessionId: "mvs_child",
    createdAtMs: 1_799_600_000_000,
    deliveredAtMs: 1_799_600_500_000,
    ...overrides,
  };
}

/** Minimal Cron owner: the bridge only forwards to these members. */
function cronOwner(overrides: Partial<V1CronAgentToolService> = {}) {
  const calls: Record<string, unknown[]> = {};
  const record =
    <T,>(name: string, impl: (input: T) => unknown) =>
    (input: T) => {
      (calls[name] ??= []).push(input);
      return impl(input) as never;
    };
  const owner: V1CronAgentToolService = {
    listDefinitions: record("listDefinitions", () => ({
      items: [definition()],
      hasMore: false,
    })),
    getDefinition: record("getDefinition", () => definition()),
    createDefinition: record("createDefinition", (command) => definition()),
    updateDefinition: record("updateDefinition", () => definition()),
    deleteDefinition: record("deleteDefinition", () => undefined),
    triggerManualRun: record("triggerManualRun", () => run()),
    listRuns: record("listRuns", () => ({ items: [run()], hasMore: false })),
    ...overrides,
  } as V1CronAgentToolService;
  return { owner, calls };
}

describe("v1 Mavis Cron adapter bridge", () => {
  it("lists Cron definitions as Mavis Cron tasks and forwards the agent filter", async () => {
    const { owner, calls } = cronOwner();
    const bridge = createV1MavisCronAdapterBridge();
    bridge.bindService(owner);

    const listed = await bridge.adapter.listCrons({ agentName: "mavis" });

    expect(calls.listDefinitions).toEqual([{ agentName: "mavis" }]);
    expect(listed.tasks).toEqual([
      {
        cronId: "cron-1",
        cronName: "count-projects",
        agentName: "mavis",
        scheduleType: "cron",
        schedule: "0 9 * * *",
        timezone: "Asia/Shanghai",
        enabled: true,
        prompt: "数一下项目数量",
        session: { mode: "new" },
        nextRun: 1_800_000_000_000,
        status: "active",
      },
    ]);
    expect(listed.hasMore).toBe(false);
  });

  it("creates recurring, self-reminder and one-shot definitions through the Cron owner", async () => {
    const { owner, calls } = cronOwner();
    const bridge = createV1MavisCronAdapterBridge();
    bridge.bindService(owner);

    await bridge.adapter.createCron({
      agentName: "mavis",
      cronName: "count-projects",
      schedule: "0 9 * * *",
      prompt: "数一下项目数量",
      timezone: "Asia/Shanghai",
      session: { mode: "new" },
    });
    await bridge.adapter.createSelfReminder({
      agentName: "mavis",
      sessionId: "mvs_self",
      every: "1h",
      prompt: "检查 CI",
    });
    await bridge.adapter.createOnceCron({
      agentName: "mavis",
      cronName: "once-demo",
      after: "10m",
      prompt: "提醒我",
      session: { mode: "new" },
    });

    expect(calls.createDefinition).toHaveLength(3);
    expect(calls.createDefinition?.[0]).toMatchObject({
      name: "count-projects",
      agentName: "mavis",
      schedule: {
        kind: "recurring",
        expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
      },
      prompt: "数一下项目数量",
      sessionTarget: { mode: "new" },
    });
    expect(calls.createDefinition?.[1]).toMatchObject({
      agentName: "mavis",
      schedule: { kind: "recurring", expression: "0 */1 * * *" },
      sessionTarget: { mode: "sessionId", sessionId: "mvs_self" },
    });
    expect(calls.createDefinition?.[2]).toMatchObject({
      name: "once-demo",
      schedule: { kind: "once" },
      prompt: "提醒我",
      sessionTarget: { mode: "new" },
    });
  });

  it("reads, updates, deletes and triggers a definition, and reports run history", async () => {
    const { owner, calls } = cronOwner();
    const bridge = createV1MavisCronAdapterBridge();
    bridge.bindService(owner);

    const fetched = await bridge.adapter.getCron({ cronId: "cron-1" });
    await bridge.adapter.updateCron({
      cronId: "cron-1",
      schedule: "*/5 * * * *",
      enabled: false,
    });
    const deleted = await bridge.adapter.deleteCron({ cronId: "cron-1" });
    const triggered = await bridge.adapter.triggerCron({ cronId: "cron-1" });
    const history = await bridge.adapter.listCronSessions({ cronId: "cron-1" });

    expect(fetched.task).toMatchObject({
      cronId: "cron-1",
      cronName: "count-projects",
      scheduleType: "cron",
      status: "active",
    });
    expect(calls.updateDefinition?.[0]).toMatchObject({
      cronId: "cron-1",
      schedule: { kind: "recurring", expression: "*/5 * * * *" },
      enabled: false,
    });
    expect(calls.deleteDefinition).toEqual([{ cronId: "cron-1" }]);
    expect(deleted).toEqual({ success: true });
    expect(calls.triggerManualRun).toEqual(["cron-1"]);
    expect(triggered).toMatchObject({
      success: true,
      runId: "run-1",
      sessionId: "mvs_child",
      status: "delivered",
      triggerSource: "manual",
    });
    expect(calls.listRuns).toEqual([{ cronId: "cron-1" }]);
    expect(history.sessions).toEqual([
      {
        runId: "run-1",
        createdAt: 1_799_600_000_000,
        status: "delivered",
        triggerSource: "manual",
        sessionId: "mvs_child",
        deliveredAt: 1_799_600_500_000,
      },
    ]);
  });

  it("answers CRON_UNAVAILABLE until the Cron owner is bound", async () => {
    const bridge = createV1MavisCronAdapterBridge();

    await expect(bridge.adapter.listCrons({})).rejects.toMatchObject({
      code: "CRON_UNAVAILABLE",
    });
  });

  it("refuses to bind a second Cron owner", () => {
    const { owner } = cronOwner();
    const bridge = createV1MavisCronAdapterBridge();
    bridge.bindService(owner);

    expect(() => bridge.bindService(owner)).toThrow(
      "Cron service is already bound",
    );
  });
});
