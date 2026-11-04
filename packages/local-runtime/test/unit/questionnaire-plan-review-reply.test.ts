import { describe, expect, it, vi } from 'vitest';

import {
  LocalQuestionnaireService,
  type LocalQuestionnaireServiceDeps,
} from '../../src/questionnaire/service.js';
import type { QuestionnaireRequestRecord } from '../../src/questionnaire/store.js';
import {
  buildQuestionnaireServiceDeps,
  createQuestionnaireOwnedActionBinder,
  type RouteContextHostHandle,
} from '../../src/api/host-route-contexts.js';
import { createPlanQuestionnaireActionHandler } from '../../../local-runtime-v2/src/service/plan/questionnaire/questionnaire-action-handler.js';

describe('Plan review Questionnaire replies', () => {
  it('uses a Plan handler bound after the process-local reply service was created', async () => {
    const requestId = 'plan-review-late-binding';
    let record: QuestionnaireRequestRecord = {
      requestId,
      sessionId: 'session-1',
      agentName: 'mavis',
      request: {
        id: requestId,
        createdAt: 1,
        mode: 'plan',
        modePayload: {
          planReview: {
            markdown: '# Plan',
            path: '/data/v2/sessions/session-1/artifacts/plan.md',
          },
        },
        steps: [
          {
            id: 'plan-review',
            question: 'Approve this plan?',
            options: [{ id: 'approve', label: 'Approve' }],
          },
        ],
      } as never,
      status: 'pending',
      createdAt: 1,
    };
    const store = {
      get: vi.fn(async () => record),
      settleReply: vi.fn(async (_requestId: string, answeredAt: number, replyPayload: never) => {
        record = { ...record, status: 'answered', answeredAt, replyPayload };
        return true;
      }),
      markInjected: vi.fn(async (_requestId: string, injectedAt: number) => {
        record = { ...record, injectedAt };
        return true;
      }),
    };
    const host = {
      agentName: 'mavis',
      nowMs: () => 2,
      configGetter: () => ({ dataDir: '/data' }),
      emitBusEvent: vi.fn(),
      publishGlobalEvent: vi.fn(),
      getSessionById: async () => ({ sessionId: 'session-1' }),
      getRuntimeOwnerKind: () => 'webui',
      agentRuntimePort: {} as never,
      permissionRules: {},
      permissionApprovalService: {} as never,
      channelPermissionBridge: {},
      questionnaireStore: store,
      questionnaireAutoReplyScheduler: {} as never,
      threadGoal: { store: { getBySession: async () => undefined } },
    } as unknown as RouteContextHostHandle;
    const bindOwnedAction = createQuestionnaireOwnedActionBinder(host);
    // The compatibility façade owns this service before Plan initializes and
    // binds its handler. This matches the runtime startup order behind the UI error.
    const service = new LocalQuestionnaireService(buildQuestionnaireServiceDeps(host));
    const approve = vi.fn(async () => undefined);
    bindOwnedAction(
      createPlanQuestionnaireActionHandler({
        application: { approve } as never,
        dispatchQueue: vi.fn(async () => undefined),
        onDispatchFailure: vi.fn(),
      }),
    );

    await service.reply({
      agentName: 'mavis',
      requestId,
      reply: {
        schemaVersion: 2,
        requestId,
        answers: [
          { stepId: 'plan-review', selectedOptionIds: ['approve'], selectedOther: false },
        ],
        submittedAt: 2,
      },
    });

    expect(approve).toHaveBeenCalledWith({
      requestId,
      sessionId: 'session-1',
      markdown: '# Plan',
      planPath: '/data/v2/sessions/session-1/artifacts/plan.md',
    });
    expect(record).toMatchObject({ status: 'answered', injectedAt: 2 });
  });

  it('does not report success when approval failed and the lifecycle remains incomplete', async () => {
    const requestId = 'plan-review-1';
    let record: QuestionnaireRequestRecord = {
      requestId,
      sessionId: 'session-1',
      agentName: 'mavis',
      request: {
        id: requestId,
        createdAt: 1,
        mode: 'plan',
        modePayload: {
          planReview: {
            markdown: '# Plan',
            path: '/data/v2/sessions/session-1/artifacts/plan.md',
          },
        },
        steps: [
          {
            id: 'plan-review',
            question: 'Approve this plan?',
            options: [{ id: 'approve', label: 'Approve' }],
          },
        ],
      } as never,
      status: 'pending',
      createdAt: 1,
    };
    const onOwnedActionFailure = vi.fn();
    const emitBusEvent = vi.fn();
    const approve = vi.fn().mockRejectedValue(new Error('Plan approval could not be committed'));
    const store = {
      get: vi.fn(async () => record),
      settleReply: vi.fn(async (_requestId, answeredAt, replyPayload) => {
        record = { ...record, status: 'answered', answeredAt, replyPayload };
        return true;
      }),
      markInjected: vi.fn(async (_requestId, injectedAt) => {
        record = { ...record, injectedAt };
        return true;
      }),
    };
    const deps = {
      store,
      nowMs: () => 2,
      primaryAgentName: 'mavis',
      configGetter: () => ({}),
      getSessionById: async () => ({ sessionId: 'session-1' }),
      emitBusEvent,
      ownedActionHandler: createPlanQuestionnaireActionHandler({
        application: { approve } as never,
        dispatchQueue: vi.fn(async () => undefined),
        onDispatchFailure: vi.fn(),
      }),
      onOwnedActionFailure,
    } as unknown as LocalQuestionnaireServiceDeps;
    const service = new LocalQuestionnaireService(deps);

    const reply = {
      schemaVersion: 2 as const,
      requestId,
      answers: [
        {
          stepId: 'plan-review',
          selectedOptionIds: ['approve'],
          selectedOther: false,
        },
      ],
      submittedAt: 2,
    };

    await expect(
      service.reply({ agentName: 'mavis', requestId, reply }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'QUESTIONNAIRE_CONTINUATION_NOT_STARTED',
    });
    expect(onOwnedActionFailure).toHaveBeenCalledWith(requestId);
    expect(approve).toHaveBeenCalledWith({
      requestId,
      sessionId: 'session-1',
      markdown: '# Plan',
      planPath: '/data/v2/sessions/session-1/artifacts/plan.md',
    });
    expect(record).toMatchObject({ status: 'answered' });
    expect(record.injectedAt).toBeUndefined();
  });
});
