// The scheduled-task editor.
//
// `SchedulingEditorView` is a pure render of a draft, so every branch — each preset's fields, the
// field-level message a rejection carries, the busy state — is testable through
// `renderToStaticMarkup`. `SchedulingEditor` is the small stateful part: it holds the draft, turns it
// into a schedule through the projection, and submits through the owner.
//
// The presets are the point. A person creating "每天 09:00" never types cron; what they pick is
// converted once, in the projection, into the schedule the runtime stores — so the form and the
// shared row cannot disagree about what the preset means.
import { useState, type ReactElement } from "react";
import { WebuiInline } from "../../../ui/layout-primitives.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { WebuiDialog } from "../../../ui/dialog.js";

import type {
  WebuiCronSchedule,
  WebuiCronTask,
  WebuiCronTaskCreateRequest,
  WebuiCronTaskUpdateRequest,
} from "../../../../shared/contracts/cron.js";
import type { WebuiSchedulingOwner } from "../application/scheduling-owner.js";
import {
  WEBUI_CRON_EMPTY_DRAFT,
  WEBUI_CRON_PRESET_LABELS,
  webuiCronDraftFromTask,
  webuiCronScheduleFromDraft,
  webuiCronUpdateRequest,
  type WebuiCronDraft,
  type WebuiCronSchedulePreset,
} from "../projection/scheduling-panel.js";
import { WebuiButton } from "../../../ui/button.js";
import { useWebuiToastError } from "../../../ui/toast.js";
import { WebuiField, WebuiFormLayout, WebuiSelectMenu, WebuiTextarea, WebuiTextInput, useWebuiFormValidation, type WebuiFieldErrors } from "../../../ui/field.js";

export interface SchedulingEditorViewProps {
  readonly mode: "create" | "edit";
  readonly draft: WebuiCronDraft;
  readonly busy: boolean;
  /** A rejection from the validator or the runtime, shown above the buttons. */
  readonly error?: string;
  readonly fieldErrors?: WebuiFieldErrors;
  readonly onChange: (patch: Partial<WebuiCronDraft>) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}

export function SchedulingEditorView(props: SchedulingEditorViewProps): ReactElement {
  const { draft, onChange } = props;
  /* The rejection is an event, not a state: it is said once, and the draft
   * keeps what the person typed. */
  useWebuiToastError(props.error, {
    dataAttributes: { "data-webui-scheduling-editor-error": "true" },
  });
  return (
    <form
      data-webui-component="scheduling-editor"
      data-webui-scheduling-editor-mode={props.mode}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
      id="webui-scheduling-editor-form"
      className="flex flex-col gap-4"
    >
      <WebuiFormLayout>
        <WebuiField
          label="名称"
          required
          error={props.fieldErrors?.name}
          control={(props) => (
            <WebuiTextInput
              {...props}
              controlSize="dense"
              type="text"
              data-webui-scheduling-field="name"
              placeholder="例如：每日项目进展"
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          )}
        />
        {props.mode === "create"
          ? <WebuiField
            label="执行 agent"
            required
            error={props.fieldErrors?.agentName}
            control={(props) => (
              <WebuiTextInput
                {...props}
                controlSize="dense"
                type="text"
                data-webui-scheduling-field="agentName"
                placeholder="输入要执行任务的 Agent 名称"
                value={draft.agentName}
                onChange={(event) => onChange({ agentName: event.target.value })}
              />
            )}
          />
          : null}
        <WebuiField
          label="请求"
          required
          error={props.fieldErrors?.prompt}
          control={(props) => (
            <WebuiTextarea
              {...props}
              controlSize="compact"
              data-webui-scheduling-field="prompt"
              placeholder="描述需要定期执行的任务"
              value={draft.prompt}
              rows={2}
              onChange={(event) => onChange({ prompt: event.target.value })}
            />
          )}
        />
        <WebuiField
          label="周期"
          control={(controlProps, field) => (
            <WebuiSelectMenu
              {...controlProps}
              labelId={field.labelId}
              className="webui-control--dense"
              data-webui-scheduling-field="preset"
              options={(Object.keys(WEBUI_CRON_PRESET_LABELS) as WebuiCronSchedulePreset[]).map((preset) => ({
                value: preset,
                label: WEBUI_CRON_PRESET_LABELS[preset],
              }))}
              value={draft.preset}
              onChange={(value) => onChange({ preset: value as WebuiCronSchedulePreset })}
            />
          )}
        />
        {draft.preset === "daily" || draft.preset === "weekly"
          ? <WebuiField
            label="时间（HH:MM）"
            control={(props) => (
              <WebuiTextInput
                {...props}
                controlSize="dense"
                type="text"
                data-webui-scheduling-field="time"
                placeholder="09:00"
                value={draft.time}
                onChange={(event) => onChange({ time: event.target.value })}
              />
            )}
          />
          : null}
        {draft.preset === "weekly"
          ? <WebuiField
            label="星期（0 为周日）"
            control={(props) => (
              <WebuiTextInput
                {...props}
                controlSize="dense"
                type="text"
                data-webui-scheduling-field="weekday"
                placeholder="例如：1（周一）"
                value={draft.weekday}
                onChange={(event) => onChange({ weekday: event.target.value })}
              />
            )}
          />
          : null}
        {draft.preset === "hourly"
          ? <WebuiField
            label="每小时的分钟数（0-59）"
            control={(props) => (
              <WebuiTextInput
                {...props}
                controlSize="dense"
                type="text"
                data-webui-scheduling-field="minute"
                placeholder="例如：0"
                value={draft.minute}
                onChange={(event) => onChange({ minute: event.target.value })}
              />
            )}
          />
          : null}
        {draft.preset === "once"
          ? <WebuiField
            label="执行时间"
            control={(props) => (
              <WebuiTextInput
                {...props}
                controlSize="dense"
                type="datetime-local"
                data-webui-scheduling-field="onceAt"
                value={draft.onceAt}
                onChange={(event) => onChange({ onceAt: event.target.value })}
              />
            )}
          />
          : null}
        {draft.preset === "custom"
          ? <WebuiField
            label="cron 表达式（五段）"
            control={(props) => (
              <WebuiTextInput
                {...props}
                controlSize="dense"
                type="text"
                data-webui-scheduling-field="expression"
                placeholder="例如：0 9 * * 1-5"
                value={draft.expression}
                onChange={(event) => onChange({ expression: event.target.value })}
              />
            )}
          />
          : null}
        <WebuiField
          label="模型（可选）"
          control={(props) => (
            <WebuiTextInput
              {...props}
              controlSize="dense"
              type="text"
              data-webui-scheduling-field="model"
              placeholder="输入模型名称，留空使用默认模型"
              value={draft.model}
              onChange={(event) => onChange({ model: event.target.value })}
            />
          )}
        />
        <WebuiField
          label="项目（可选）"
          control={(props) => (
            <WebuiTextInput
              {...props}
              controlSize="dense"
              type="text"
              data-webui-scheduling-field="project"
              placeholder="输入项目路径或名称，可留空"
              value={draft.project}
              onChange={(event) => onChange({ project: event.target.value })}
            />
          )}
        />
        <WebuiField
          label="会话（留空则每次新建）"
          control={(props) => (
            <WebuiTextInput
              {...props}
              controlSize="dense"
              type="text"
              data-webui-scheduling-field="sessionId"
              placeholder="输入会话 ID，留空则每次新建"
              value={draft.sessionId}
              onChange={(event) => onChange({ sessionId: event.target.value })}
            />
          )}
        />
      </WebuiFormLayout>
    </form>
  );
}

export function SchedulingEditor(props: {
  readonly owner: WebuiSchedulingOwner;
  readonly task?: WebuiCronTask;
  readonly open: boolean;
  readonly seed?: Partial<WebuiCronDraft>;
  /** The agent a new task belongs to; the panel passes the client's own. */
  readonly agentName?: string;
  readonly nowMs: () => number;
  readonly onDone: () => void;
  readonly onExitComplete: () => void;
}): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  // Read once: a narrowed `props.task` inside the submit closure loses the narrowing.
  const editingTask = props.task;
  const mode = editingTask ? "edit" : "create";
  const [initialDraft] = useState<WebuiCronDraft>(() =>
    editingTask
      ? webuiCronDraftFromTask(editingTask)
      : { ...WEBUI_CRON_EMPTY_DRAFT, agentName: props.agentName ?? "", ...(props.seed ?? {}) },
  );
  const [draft, setDraft] = useState<WebuiCronDraft>(initialDraft);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { errors: fieldErrors, validateRequired, clearFieldError } = useWebuiFormValidation();

  const submit = async (): Promise<void> => {
    const agentName = draft.agentName.trim();
    setError(undefined);
    if (!validateRequired([
      { name: "name", label: "名称", value: draft.name },
      { name: "prompt", label: "请求", value: draft.prompt },
      { name: "agentName", label: "执行 agent", value: draft.agentName, required: editingTask === undefined },
    ])) return;
    // A create always carries a schedule; an edit carries one only when the schedule changed — see
    // `webuiCronUpdateRequest`, which owns that rule for the same reason it owns the conversion.
    const converted = webuiCronScheduleFromDraft(draft, props.nowMs());
    if (editingTask === undefined && !converted.ok) return setError(converted.message);

    setBusy(true);
    setError(undefined);
    const sessionTarget = draft.sessionId.trim()
      ? { mode: "sessionId" as const, sessionId: draft.sessionId.trim() }
      : { mode: "new" as const };
    const optional = {
      ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
      ...(draft.project.trim() ? { project: draft.project.trim() } : {}),
    };
    let result: { readonly ok: true } | { readonly ok: false; readonly message: string };
    if (editingTask !== undefined) {
      const built = webuiCronUpdateRequest(draft, initialDraft, editingTask, props.nowMs());
      result = built.ok ? await props.owner.updateTask(built.request) : built;
    } else {
      if (!converted.ok) return setError(converted.message);
      result = await props.owner.createTask({
        name: draft.name,
        agentName,
        prompt: draft.prompt,
        schedule: converted.schedule,
        sessionTarget,
        ...optional,
      } satisfies WebuiCronTaskCreateRequest);
    }
    setBusy(false);
    if (!result.ok) return setError(result.message);
    props.onDone();
  };

  /**
   * Whether the footer's primary action can be pressed.
   *
   * The same fields `submit` validates: a task with no name, no instruction or
   * no agent is not offered a button whose only answer is a field error.
   */
  const canSubmit =
    draft.name.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    (editingTask !== undefined || draft.agentName.trim().length > 0);

  return (
    <WebuiDialog
      id="webui-scheduling-editor-dialog"
      open={props.open}
      title={editingTask ? "编辑定时任务" : "新建定时任务"}
      description={editingTask ? "调整任务内容和执行计划" : "设置任务指令与自动执行计划"}
      width="wide"
      portalTarget={dom.portalTarget()}
      onClose={props.onDone}
      onExitComplete={props.onExitComplete}
      dismissOnEscape
      dismissOnBackdrop
      testId="webui-scheduling-editor-dialog"
      footer={(
        <WebuiInline gap="small">
          <WebuiButton variant="secondary" size="dialog" type="button" data-webui-scheduling-cancel="true" onClick={props.onDone}>
            取消
          </WebuiButton>
          <WebuiButton variant="primary" size="dialog" type="submit" form="webui-scheduling-editor-form"
            data-webui-scheduling-submit="true" loading={busy} disabled={!canSubmit}
            loadingLabel={editingTask ? "保存中…" : "创建中…"}
          >
            {editingTask ? "保存" : "创建任务"}
          </WebuiButton>
        </WebuiInline>
      )}
    >
      <SchedulingEditorView
        mode={mode}
        draft={draft}
        busy={busy}
        fieldErrors={fieldErrors}
        {...(error === undefined ? {} : { error })}
        onChange={(patch) => {
          setDraft((current) => ({ ...current, ...patch }));
          for (const field of Object.keys(patch)) clearFieldError(field);
        }}
        onCancel={props.onDone}
        onSubmit={() => void submit()}
      />
    </WebuiDialog>
  );
}
