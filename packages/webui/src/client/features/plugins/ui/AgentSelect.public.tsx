// The agent catalogue as a form control.
//
// A scheduled task names the agent it runs as, and the name has to be one the
// runtime actually has. Typing it from memory produced tasks that failed on
// their first run with "agent not found", so the field reads the catalogue the
// plugins business already lists and offers it as a list.
//
// The list is the one this business owns: `listAgents` through the plugin
// workflows, read once per workflow revision and cached until a plugin write
// bumps it. The panel and the field are published together so a peer (the
// scheduling business) renders the same rows this business's own pages do,
// instead of a second copy of the name/description reading rules.

import { useCallback, useEffect, useId, useMemo, useState, type ReactElement } from "react";

import { useWebuiPluginWorkflows, useWebuiPluginWorkflowsState } from "../../../bindings/use-query-state.js";
import { WebuiIconChevronDown } from "../../../shell/icons.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
import { WebuiMotion } from "../../../ui/page.js";
import { FeedbackEmpty } from "../../../ui/feedback.js";
import type { FieldControlProps } from "../../../ui/field.js";
import type { WebuiAgentOption } from "../contracts/plugin-rows.js";

export type { WebuiAgentOption };

/** What one read of the catalogue answered. */
export interface WebuiAgentOptionsState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly agents: readonly WebuiAgentOption[];
  readonly error?: string;
}

const IDLE: WebuiAgentOptionsState = { status: "idle", agents: [] };

/**
 * The agent catalogue, cached for the revision it was read under.
 *
 * One cache for the process, keyed by the workflow revision: several fields
 * open at once read once, and a plugin write (which bumps the revision) is what
 * makes the next read happen. A failure is not cached — the field would
 * otherwise stay empty until the page reloaded.
 */
let cachedRevision: number | undefined;
let cachedAgents: readonly WebuiAgentOption[] = [];
let inFlight: Promise<readonly WebuiAgentOption[]> | undefined;

export function useWebuiAgentOptions(): WebuiAgentOptionsState {
  const workflows = useWebuiPluginWorkflows();
  const revision = useWebuiPluginWorkflowsState().revision;
  const [state, setState] = useState<WebuiAgentOptionsState>(
    cachedRevision === revision && cachedAgents.length > 0
      ? { status: "ready", agents: cachedAgents }
      : IDLE,
  );

  useEffect(() => {
    if (!workflows?.listAgentOptions) return;
    if (cachedRevision === revision && cachedAgents.length > 0) {
      setState({ status: "ready", agents: cachedAgents });
      return;
    }
    let live = true;
    setState((current) => (current.status === "ready" ? current : { status: "loading", agents: [] }));
    const read = inFlight ?? workflows.listAgentOptions();
    inFlight = read;
    read.then(
      (agents) => {
        inFlight = undefined;
        cachedRevision = revision;
        cachedAgents = agents;
        if (live) setState({ status: "ready", agents });
      },
      (reason: unknown) => {
        inFlight = undefined;
        if (live) {
          setState({
            status: "error",
            agents: [],
            error: reason instanceof Error ? reason.message : String(reason),
          });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [revision, workflows]);

  return state;
}

export interface WebuiAgentListPanelProps {
  readonly agents: readonly WebuiAgentOption[];
  readonly selected: string;
  readonly onSelect: (name: string) => void;
  readonly loading?: boolean;
  readonly error?: string;
  /** A row above the list that clears the choice. */
  readonly defaultOption?: {
    readonly label: string;
    readonly active: boolean;
    readonly onSelect: () => void;
  };
}

/** The catalogue as a list: one row per agent, the chosen one ticked. */
export function WebuiAgentListPanel({
  agents,
  selected,
  onSelect,
  loading = false,
  error,
  defaultOption,
}: WebuiAgentListPanelProps): ReactElement {
  return (
    <WebuiMotion
      as="div"
      kind="surface"
      className="webui-stack webui-stack--gap-medium webui-stack--align-stretch webui-stack--justify-start webui-agent-list"
      data-webui-agent-list="true"
    >
      <div className="webui-agent-list-head">
        <span className="webui-agent-list-title">选择 agent</span>
      </div>
      <div className="webui-agent-list-rows">
        {loading && agents.length === 0 ? <FeedbackEmpty className="webui-agent-list-empty" title="正在读取 agent…" /> : null}
        {error ? <FeedbackEmpty className="webui-agent-list-empty" title={error} /> : null}
        {!loading && !error && agents.length === 0 && defaultOption === undefined ? (
          <FeedbackEmpty className="webui-agent-list-empty" title="没有可用的 agent" />
        ) : null}
        {defaultOption ? (
          <WebuiButton
            variant="selectable-row"
            size="regular"
            className={`webui-agent-list-row ${defaultOption.active ? "is-active" : ""}`}
            data-webui-agent-list-default="true"
            aria-pressed={defaultOption.active}
            onClick={defaultOption.onSelect}
          >
            <span className="webui-agent-list-row-name">{defaultOption.label}</span>
          </WebuiButton>
        ) : null}
        {agents.map((agent) => {
          const active = agent.name === selected;
          return (
            <WebuiButton
              variant="selectable-row"
              size="regular"
              key={agent.name}
              className={`webui-agent-list-row ${active ? "is-active" : ""}`}
              data-webui-agent-list-row={agent.name}
              aria-pressed={active}
              onClick={() => onSelect(agent.name)}
            >
              <span className="webui-agent-list-row-name">{agent.displayName}</span>
              {agent.description ? (
                <span className="webui-agent-list-row-description">{agent.description}</span>
              ) : null}
            </WebuiButton>
          );
        })}
      </div>
    </WebuiMotion>
  );
}

export interface WebuiAgentSelectProps extends Partial<FieldControlProps> {
  /** The agent's name, or `""` for nothing chosen. */
  readonly value: string;
  readonly onChange: (name: string) => void;
  readonly placeholder?: string;
  /** The row that clears the choice. Omitted, the choice is required. */
  readonly defaultLabel?: string;
  /** Matches the inputs around it: `regular` is the default field height. */
  readonly controlSize?: "regular" | "dense";
  readonly disabled?: boolean;
  readonly testId?: string;
  /** Extra attributes for a surface that marks its own fields, e.g. a form's test hook. */
  readonly dataAttributes?: Readonly<Record<string, string>>;
}

export function WebuiAgentSelect({
  value,
  onChange,
  placeholder = "选择 agent",
  defaultLabel,
  controlSize = "regular",
  disabled = false,
  testId,
  dataAttributes,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: WebuiAgentSelectProps): ReactElement {
  const options = useWebuiAgentOptions();
  const [open, setOpen] = useState(false);
  const instanceId = useId();
  const layerId = useMemo(
    () => `agent-select-${instanceId.replace(/[^a-zA-Z0-9_-]/gu, "")}`,
    [instanceId],
  );
  const selected = options.agents.find((agent) => agent.name === value);
  const triggerLabel = selected ? selected.displayName : value || placeholder;
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="webui-agent-select" data-testid={testId} {...dataAttributes}>
      <WebuiDropdown
        open={open}
        onOpen={() => setOpen(true)}
        onClose={close}
        managed
        managedLayerId={layerId}
        role="dialog"
        labelledBy={id ?? instanceId}
        side="bottom"
        align="start"
        offset={4}
        collision="flip"
        wrapperClassName="webui-agent-select-field"
        className="webui-agent-menu"
        popupDataAttributes={{ "data-webui-agent-menu": "true" }}
        trigger={(triggerProps) => (
          <WebuiButton
            variant="plain"
            size="regular"
            {...triggerProps}
            id={id ?? instanceId}
            className={`webui-agent-select-trigger${controlSize === "dense" ? " webui-agent-select-trigger--dense" : ""}`}
            aria-label={id === undefined ? placeholder : undefined}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-required={ariaRequired}
            disabled={disabled}
          >
            <span
              className={`webui-agent-select-label${selected ? "" : " webui-agent-select-label--placeholder"}`}
            >
              {triggerLabel}
            </span>
            <WebuiIconChevronDown className="webui-agent-select-chevron" />
          </WebuiButton>
        )}
      >
        <div className="webui-agent-popup" data-webui-agent-popup="true">
          <WebuiAgentListPanel
            agents={options.agents}
            selected={value}
            loading={options.status === "loading" || options.status === "idle"}
            {...(options.error ? { error: options.error } : {})}
            onSelect={(name) => {
              onChange(name);
              close();
            }}
            {...(defaultLabel
              ? {
                  defaultOption: {
                    label: defaultLabel,
                    active: value === "",
                    onSelect: () => {
                      onChange("");
                      close();
                    },
                  },
                }
              : {})}
          />
        </div>
      </WebuiDropdown>
    </div>
  );
}
