// The published surface of the scheduled-task panel.
//
// The shell is a peer of this business and may only import what the business publishes, and a
// published module may not re-export another module's symbol — so the panel lives here and is
// published as itself rather than through a forwarding file. The owner it subscribes to and the
// projection it renders stay private to the business.
// The scheduled-task panel.
//
// Split in two on purpose. `SchedulingPanelView` is a pure render of a snapshot, so a test can pin
// every branch — rows, empty state, load failure, the not-held hint — through
// `renderToStaticMarkup` without a DOM (there is no jsdom in this package). `SchedulingPanel` is the
// thin part that subscribes to the owner, reads once when it opens, and re-reads on an interval
// while it stays open, which is what makes a task created in another client appear without a manual
// reload.
//
// The panel is a surface of its own, not a section of the settings modal and not a tab of the
// session-scoped workspace panel: scheduled tasks are not session-scoped (ADR 0027).
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import {
  IconBriefcase,
  IconCalendarWeek,
  IconClockHour4,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { WebuiInline, WebuiStack } from "../../../ui/layout-primitives.js";

import type { WebuiCronRun, WebuiCronTask } from "../../../../shared/contracts/cron.js";
import type {
  WebuiSchedulingOwner,
  WebuiSchedulingSnapshot,
} from "../application/scheduling-owner.js";
import {
  webuiCronRunRows,
  WEBUI_SCHEDULING_EMPTY_TEXT,
  WEBUI_SCHEDULING_LOADING_TEXT,
  WEBUI_SCHEDULING_OTHER_HOST_HINT,
  webuiSchedulingRows,
} from "../projection/scheduling-panel.js";
import { PanelFrame } from "../../../ui/content-page.js";
import { SchedulingEditor } from "./scheduling-editor.js";
import { WebuiButton, WebuiIconButton } from "../../../ui/button.js";
import { WebuiDisclosure } from "../../../ui/page.js";
import { WebuiSearchField } from "../../../ui/field.js";
import { WebuiCard } from "../../../ui/card.js";
import { FeedbackEmpty, FeedbackError } from "../../../ui/feedback.js";
import type { WebuiCronDraft } from "../projection/scheduling-panel.js";

export interface SchedulingPanelViewProps {
  readonly snapshot: WebuiSchedulingSnapshot;
  readonly nowMs: number;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  /** The open editor, if any. Rendered above the list so the form and the rows share one scroll. */
  readonly editor?: ReactNode;
  readonly onCreate: () => void;
  readonly onCreateTemplate: (seed: Partial<WebuiCronDraft>) => void;
  readonly selectedTaskId?: string;
  readonly onSelectTask: (task: WebuiCronTask) => void;
  readonly onEdit: (task: WebuiCronTask) => void;
  readonly onToggle: (task: WebuiCronTask) => void;
  /** Deletes after a second click: a destructive action should not be one stray click away. */
  readonly onDelete: (task: WebuiCronTask) => void;
  /** The row whose delete button is asking for confirmation. */
  readonly confirmingDelete?: string;
  readonly onRequestDelete: (task: WebuiCronTask) => void;
  readonly onCancelDelete: () => void;
  /** Runs one task immediately. */
  readonly onRunNow: (task: WebuiCronTask) => void;
  /** The task whose history is open, and that history. */
  readonly expandedRuns?: string;
  readonly runs?: ReadonlyMap<string, readonly WebuiCronRun[]>;
  readonly onToggleRuns: (task: WebuiCronTask) => void;
  /** Opens the session a run produced. */
  readonly onOpenSession: (sessionId: string) => void;
  /** A run or history read that failed, shown above the list. */
  readonly runError?: string;
}

export function SchedulingPanelView(props: SchedulingPanelViewProps): ReactElement {
  const rows = webuiSchedulingRows(props.snapshot.tasks, props.nowMs);
  const tasksById = new Map(props.snapshot.tasks.map((task) => [task.cronId, task]));
  const [query, setQuery] = useState("");
  const matchingRows = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return value
      ? rows.filter((row) => `${row.name} ${row.scheduleLabel} ${row.nextRunLabel}`.toLocaleLowerCase().includes(value))
      : rows;
  }, [query, rows]);
  const selectedRow = rows.find((row) => row.cronId === props.selectedTaskId) ?? rows[0];
  const selectedTask = selectedRow ? tasksById.get(selectedRow.cronId) : undefined;
  const hasLoadedBefore = props.snapshot.loadedAtMs !== undefined;
  const initialLoading = props.snapshot.status === "loading" && !hasLoadedBefore;
  // "No task exists yet" is only true of a *successful* empty read: a failed one is not empty, and
  // saying so would invite the person to create a task they may already have.
  // Keep the last successful empty state visible while the background refresh is in flight.
  const showEmpty = rows.length === 0 && (
    props.snapshot.status === "ready" || (props.snapshot.status === "loading" && hasLoadedBefore)
  );
  const templates = [
    {
      title: "每日工作总结",
      description: "在一天结束时回顾项目进展与待办。",
      icon: <IconBriefcase size={22} stroke={1.6} />,
      seed: { name: "每日工作总结", prompt: "总结今天的工作进展、已完成事项和待处理问题。", preset: "daily" as const, time: "18:00" },
    },
    {
      title: "每周计划整理",
      description: "每周开始时梳理本周的重点任务。",
      icon: <IconCalendarWeek size={22} stroke={1.6} />,
      seed: { name: "每周计划整理", prompt: "根据当前项目进度，整理本周的重点和优先级。", preset: "weekly" as const, weekday: "1", time: "09:00" },
    },
    {
      title: "定时检查项目",
      description: "周期检查代码变化并汇总需要关注的内容。",
      icon: <IconRefresh size={22} stroke={1.6} />,
      seed: { name: "定时检查项目", prompt: "检查项目近期变化，汇总风险和需要跟进的事项。", preset: "daily" as const, time: "09:00" },
    },
    {
      title: "一次性提醒",
      description: "为需要处理的事项创建一个定时任务。",
      icon: <IconClockHour4 size={22} stroke={1.6} />,
      seed: { name: "一次性提醒", prompt: "提醒我处理指定事项。", preset: "once" as const },
    },
  ];
  return (
    <PanelFrame
      className="bg-bg_default_primary"
      bodyClassName="webui-scheduling-layout"
      loading={initialLoading && rows.length === 0}
      ariaLabel="定时任务"
      dataAttributes={{ "data-webui-component": "scheduling-panel" }}
    >
      <aside className="webui-scheduling-sidebar">
        <header className="webui-scheduling-sidebar-header">
          <h1>定时任务</h1>
          <WebuiInline gap="tight">
            <WebuiIconButton tone="bare" label="刷新任务" data-webui-scheduling-refresh="true" onClick={props.onRefresh}>
              <IconRefresh size={18} stroke={1.7} />
            </WebuiIconButton>
            <WebuiIconButton tone="bare" label="关闭定时任务" data-webui-scheduling-close="true" onClick={props.onClose}>
              <IconX size={18} stroke={1.7} />
            </WebuiIconButton>
          </WebuiInline>
        </header>
        <div className="webui-scheduling-sidebar-content">
          <WebuiButton variant="plain" size="regular" data-webui-scheduling-new="true" className="webui-scheduling-new"
            onClick={props.onCreate}
          >
            <IconPlus size={18} stroke={1.8} />
            新建任务
          </WebuiButton>
          <WebuiSearchField
            icon={<IconSearch size={16} stroke={1.7} />}
            label="搜索定时任务"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务"
            className="webui-scheduling-search"
          />
          <div className="webui-scheduling-list-heading">
            <span>即将执行</span>
            <span>{matchingRows.length}</span>
          </div>
          {initialLoading && rows.length === 0
            ? <p data-webui-scheduling-loading="true" className="webui-scheduling-sidebar-empty">{WEBUI_SCHEDULING_LOADING_TEXT}</p>
            : null}
          {props.snapshot.status === "error" && rows.length === 0
            ? <FeedbackError message={props.snapshot.error ?? "读取定时任务失败。"} />
            : null}
          {rows.length > 0 && matchingRows.length === 0
            ? <FeedbackEmpty title="没有匹配的任务" className="webui-scheduling-sidebar-empty" />
            : null}
          <WebuiStack as="ul" gap="micro" className="webui-scheduling-task-list">
            {matchingRows.map((row) => {
              const task = tasksById.get(row.cronId);
              return task ? (
                <li key={row.cronId} data-webui-scheduling-task={row.cronId}>
                  <WebuiButton variant="selectable-row" size="regular" type="button"
                    className="webui-scheduling-task-option" aria-pressed={selectedRow?.cronId === row.cronId}
                    data-webui-scheduling-select={row.cronId} onClick={() => props.onSelectTask(task)}
                  >
                    <span className="webui-scheduling-task-option-copy">
                      <span className="webui-scheduling-task-name">{row.name}</span>
                      <span className="webui-scheduling-task-time">{row.nextRunLabel}</span>
                    </span>
                    <span className={`webui-scheduling-task-dot${row.enabled ? " is-enabled" : ""}`} aria-hidden="true" />
                  </WebuiButton>
                </li>
              ) : null;
            })}
          </WebuiStack>
          <p className="webui-scheduling-host-hint">{WEBUI_SCHEDULING_OTHER_HOST_HINT}</p>
        </div>
      </aside>
      <main className="webui-scheduling-main" data-webui-scheduling-main="true">
        {props.runError ? <FeedbackError message={props.runError} dataAttributes={{ "data-webui-scheduling-run-error": "true" }} /> : null}
        {props.snapshot.status === "error" && props.snapshot.error
          ? <FeedbackError message={props.snapshot.error} dataAttributes={{ "data-webui-scheduling-error": "true" }} />
          : null}
        {showEmpty
          ? <div className="webui-scheduling-empty-state">
            <span className="webui-scheduling-empty-icon"><IconClockHour4 size={42} stroke={1.35} /></span>
            <h2>安排任务</h2>
            <p>创建自动执行的任务，让日常工作按计划持续推进。</p>
            <div className="webui-scheduling-template-grid">
              {templates.map((template) => (
                <WebuiButton key={template.title} variant="selectable-row" size="regular" type="button"
                  className="webui-scheduling-template-card" onClick={() => props.onCreateTemplate(template.seed)}
                >
                  <span className="webui-scheduling-template-icon">{template.icon}</span>
                  <span className="webui-scheduling-template-copy">
                    <span className="webui-scheduling-template-title">{template.title}</span>
                    <span className="webui-scheduling-template-description">{template.description}</span>
                  </span>
                </WebuiButton>
              ))}
            </div>
            <p data-webui-scheduling-empty="true" className="sr-only">{WEBUI_SCHEDULING_EMPTY_TEXT}</p>
          </div>
          : selectedTask && selectedRow
            ? <div className="webui-scheduling-detail" data-webui-scheduling-detail={selectedTask.cronId}>
              <div className="webui-scheduling-detail-header">
                <div className="min-w-0">
                  <div className="webui-scheduling-detail-eyebrow">任务计划</div>
                  <h2>{selectedTask.name}</h2>
                  <p>{selectedRow.scheduleLabel}</p>
                </div>
                <span data-webui-scheduling-enabled={selectedRow.enabled ? "true" : "false"}
                  className={`webui-scheduling-enabled-badge${selectedRow.enabled ? " is-enabled" : ""}`}>
                  <span className="webui-scheduling-task-dot" aria-hidden="true" />
                  {selectedRow.enabledLabel}
                </span>
              </div>
              <WebuiInline gap="small" className="webui-scheduling-detail-actions">
                <WebuiButton variant="secondary" size="compact" data-webui-scheduling-edit={selectedTask.cronId} onClick={() => props.onEdit(selectedTask)}>编辑任务</WebuiButton>
                <WebuiButton variant="secondary" size="compact" data-webui-scheduling-toggle={selectedTask.cronId} onClick={() => props.onToggle(selectedTask)}>{selectedTask.enabled ? "停用" : "启用"}</WebuiButton>
                <WebuiButton variant="secondary" size="compact" data-webui-scheduling-run={selectedTask.cronId} onClick={() => props.onRunNow(selectedTask)}>立即执行</WebuiButton>
                <WebuiButton variant="secondary" size="compact" data-webui-scheduling-history={selectedTask.cronId}
                  aria-expanded={props.expandedRuns === selectedTask.cronId}
                  aria-controls={`webui-scheduling-runs-${encodeURIComponent(selectedTask.cronId)}`}
                  onClick={() => props.onToggleRuns(selectedTask)}
                >运行历史</WebuiButton>
                {props.confirmingDelete === selectedTask.cronId
                  ? <>
                    <WebuiButton variant="danger-soft" size="compact" data-webui-scheduling-delete-confirm={selectedTask.cronId} onClick={() => props.onDelete(selectedTask)}>确认删除</WebuiButton>
                    <WebuiButton variant="secondary" size="compact" data-webui-scheduling-delete-cancel={selectedTask.cronId} onClick={props.onCancelDelete}>取消</WebuiButton>
                  </>
                  : <WebuiButton variant="danger-soft" size="compact" data-webui-scheduling-delete={selectedTask.cronId} onClick={() => props.onRequestDelete(selectedTask)}>删除</WebuiButton>}
              </WebuiInline>
              <div className="webui-scheduling-detail-grid">
                <WebuiCard className="webui-scheduling-info-card">
                  <span className="webui-scheduling-card-label">下次执行</span>
                  <strong>{selectedRow.nextRunLabel}</strong>
                  <span className="webui-scheduling-card-note" data-webui-scheduling-hold={selectedRow.heldByThisClient ? "held" : "unheld"}>{selectedRow.holdLabel}</span>
                </WebuiCard>
                <WebuiCard className="webui-scheduling-info-card">
                  <span className="webui-scheduling-card-label">执行 Agent</span>
                  <strong>{selectedTask.agentName}</strong>
                  <span className="webui-scheduling-card-note">{selectedTask.model ?? "使用默认模型"}</span>
                </WebuiCard>
              </div>
              <WebuiCard className="webui-scheduling-prompt-card">
                <h3>任务指令</h3>
                <p>{selectedTask.prompt}</p>
                {selectedTask.project ? <span className="webui-scheduling-card-note">项目：{selectedTask.project}</span> : null}
              </WebuiCard>
              <WebuiDisclosure
                id={`webui-scheduling-runs-${encodeURIComponent(selectedTask.cronId)}`}
                open={props.expandedRuns === selectedTask.cronId}
                className="webui-scheduling-runs-disclosure"
                data-webui-scheduling-runs={selectedTask.cronId}
              >
                <WebuiCard className="webui-scheduling-history-card">
                  <h3>运行历史</h3>
                  <WebuiStack as="ul" gap="tight">
                    {(props.runs?.get(selectedTask.cronId) ?? []).length === 0
                      ? <li className="text-sm text-text_default_tertiary">还没有运行记录。</li>
                      : webuiCronRunRows(props.runs?.get(selectedTask.cronId) ?? []).map((run) => (
                        <li key={run.runId} data-webui-scheduling-run-row={run.runId} className="webui-scheduling-run-row">
                          <span>{run.whenLabel} · {run.sourceLabel} · {run.statusLabel}{run.failureLabel === undefined ? "" : ` · ${run.failureLabel}`}</span>
                          {run.sessionId === undefined ? null : <WebuiButton variant="quiet-secondary" size="inline-tiny" data-webui-scheduling-run-session={run.sessionId} onClick={() => props.onOpenSession(run.sessionId!)}>打开会话</WebuiButton>}
                        </li>
                      ))}
                  </WebuiStack>
                </WebuiCard>
              </WebuiDisclosure>
            </div>
            : <FeedbackEmpty title="没有匹配的任务" className="webui-scheduling-detail-empty" />}
      </main>
      {props.editor}
    </PanelFrame>
  );
}

export function SchedulingPanel(props: {
  readonly owner: WebuiSchedulingOwner;
  readonly nowMs: number;
  readonly onClose: () => void;
  /** The agent this client runs as, used as the default for a task created here. */
  readonly agentName?: string;
  /** Opens the session a run produced; the shell owns navigation. */
  readonly onOpenSession: (sessionId: string) => void;
}): ReactElement {
  const snapshot = useSyncExternalStore(
    props.owner.subscribe,
    props.owner.getSnapshot,
    props.owner.getSnapshot,
  );
  const [editing, setEditing] = useState<{
    readonly task?: WebuiCronTask;
    readonly seed?: Partial<WebuiCronDraft>;
    readonly open: boolean;
  } | undefined>(undefined);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [confirmingDelete, setConfirmingDelete] = useState<string | undefined>(undefined);
  const [expandedRuns, setExpandedRuns] = useState<string | undefined>(undefined);
  const [runs, setRuns] = useState<ReadonlyMap<string, readonly WebuiCronRun[]>>(new Map());
  const [runError, setRunError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void props.owner.load();
    return props.owner.startRefreshing();
  }, [props.owner]);

  return (
    <SchedulingPanelView
      snapshot={snapshot}
      nowMs={props.nowMs}
      onClose={props.onClose}
      onRefresh={() => void props.owner.load()}
      onCreate={() => setEditing({ open: true })}
      onCreateTemplate={(seed) => setEditing({ open: true, seed })}
      selectedTaskId={selectedTaskId}
      onSelectTask={(task) => setSelectedTaskId(task.cronId)}
      onEdit={(task) => setEditing({ open: true, task })}
      onToggle={(task) => void props.owner.setEnabled(task.cronId, !task.enabled)}
      onDelete={(task) => {
        setConfirmingDelete(undefined);
        void props.owner.deleteTask(task.cronId);
      }}
      {...(confirmingDelete === undefined ? {} : { confirmingDelete })}
      onRequestDelete={(task) => setConfirmingDelete(task.cronId)}
      onCancelDelete={() => setConfirmingDelete(undefined)}
      {...(runError === undefined ? {} : { runError })}
      onRunNow={(task) => {
        setRunError(undefined);
        void props.owner.runNow(task.cronId).then((result) => {
          // The history is what shows the run, so a run-now opens it.
          setExpandedRuns(task.cronId);
          void props.owner.loadRuns(task.cronId).then((history) => {
            if (history.ok) {
              setRuns((current) => new Map(current).set(task.cronId, history.runs));
            }
          });
          if (!result.ok) setRunError(result.message);
        });
      }}
      onToggleRuns={(task) => {
        if (expandedRuns === task.cronId) {
          setExpandedRuns(undefined);
          return;
        }
        setExpandedRuns(task.cronId);
        void props.owner.loadRuns(task.cronId).then((history) => {
          if (history.ok) {
            setRuns((current) => new Map(current).set(task.cronId, history.runs));
          } else {
            setRunError(history.message);
          }
        });
      }}
      {...(expandedRuns === undefined ? {} : { expandedRuns })}
      runs={runs}
      onOpenSession={(sessionId) => props.onOpenSession(sessionId)}
      editor={editing
        ? <SchedulingEditor
          key={editing.task?.cronId ?? (editing.seed?.name ?? "new")}
          owner={props.owner}
          {...(editing.task ? { task: editing.task } : {})}
          {...(editing.seed ? { seed: editing.seed } : {})}
          open={editing.open}
          nowMs={() => props.nowMs}
          onDone={() => setEditing((current) => current ? { ...current, open: false } : undefined)}
          onExitComplete={() => setEditing(undefined)}
        />
        : null}
    />
  );
}
