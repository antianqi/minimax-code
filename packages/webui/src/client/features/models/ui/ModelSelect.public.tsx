// A model as a form control.
//
// The composer's picker is a two-state popup: the model in use with its
// thinking scale, and — one step in — the catalogue grouped by provider. A form
// only ever needs the second state, so this component is that page behind a
// field-shaped trigger: the same `WebuiModelListPanel` the composer steps into,
// with no second copy of the grouping, the ticks or the row order.
//
// It names a model as a string, because that is what the definitions and the
// scheduled tasks store. The string is always `providerId/modelId`: that is the
// only form the runtime accepts for a session model, a scheduled task's model
// and an agent definition's model, and one writer for it means a form cannot
// disagree with the picker it renders. A value the catalogue does not contain
// is still shown, verbatim: the runtime may offer a model this client has not
// listed, and hiding the stored name would look like an empty field.
//
// `defaultLabel` is the row that clears the choice, and it is what makes the
// field optional. Without it the form has to be given a model, and the list has
// no way back to "the default model".

import { useId, useMemo, useState, type ReactElement } from "react";

import { useWebuiModelsWorkflowsState } from "../../../bindings/use-query-state.js";
import { WebuiIconChevronDown } from "../../../shell/icons.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
import type { FieldControlProps } from "../../../ui/field.js";
import type { WebuiModelEntry } from "../../../../shared/contracts/models.js";
import { groupModelsByProvider } from "../projection/model-picker-rows.js";
import { WebuiModelListPanel } from "./ModelListPanel.js";

/** The stored form of a model: `providerId/modelId`. */
function qualifiedModelValue(model: WebuiModelEntry): string {
  return `${model.providerId}/${model.modelId}`;
}

export interface WebuiModelSelectProps extends Partial<FieldControlProps> {
  /** The stored model name, or `""` for "the default model". */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Shown when nothing is chosen. */
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

export function WebuiModelSelect({
  value,
  onChange,
  placeholder = "选择模型",
  defaultLabel,
  controlSize = "regular",
  disabled = false,
  testId,
  dataAttributes,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: WebuiModelSelectProps): ReactElement {
  const catalogue = useWebuiModelsWorkflowsState().models;
  const [open, setOpen] = useState(false);
  const instanceId = useId();
  const layerId = useMemo(() => `model-select-${instanceId.replace(/[^a-zA-Z0-9_-]/gu, "")}`, [instanceId]);

  // A model the catalogue marks disabled is not offered for a new selection:
  // the composer hides it for the same reason, and a form that lists it would
  // let a task be created against something the runtime refuses to run.
  const models = useMemo(
    () => (catalogue.value ?? []).filter((model) => model.enabled !== false),
    [catalogue.value],
  );
  const groups = useMemo(() => groupModelsByProvider(models), [models]);
  const selected = models.find(
    (model) =>
      qualifiedModelValue(model) === value ||
      // A catalogue row is still matched by its own id, so a stored bare name
      // or a foreign value from another client is shown rather than looking
      // like an empty field.
      model.modelId === value,
  );
  const triggerLabel = selected
    ? selected.displayName ?? selected.modelId
    : value || placeholder;

  return (
    <div className="webui-model-select" data-testid={testId} {...dataAttributes}>
      <WebuiDropdown
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        // Managed (ADR 0028 § Overlay coordination): the field is used inside a
        // dialog, and an unmanaged popup would let the dialog answer the same
        // Escape as the list and close under it.
        managed
        managedLayerId={layerId}
        role="dialog"
        labelledBy={id ?? instanceId}
        side="bottom"
        align="start"
        offset={4}
        collision="flip"
        wrapperClassName="webui-model-select-field"
        className="webui-model-menu"
        popupDataAttributes={{
          "data-webui-model-menu": "true",
          "data-webui-model-view": "list",
          "data-webui-model-select-popup": "true",
        }}
        trigger={(triggerProps) => (
          <WebuiButton
            variant="plain"
            size="regular"
            {...triggerProps}
            id={id ?? instanceId}
            className={`webui-model-select-trigger${controlSize === "dense" ? " webui-model-select-trigger--dense" : ""}`}
            aria-label={id === undefined ? placeholder : undefined}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-required={ariaRequired}
            disabled={disabled}
          >
            <span
              className={`webui-model-select-label${selected ? "" : " webui-model-select-label--placeholder"}`}
            >
              {triggerLabel}
            </span>
            <WebuiIconChevronDown className="webui-model-select-chevron" />
          </WebuiButton>
        )}
      >
        <div className="webui-model-popup" data-webui-model-popup="true">
          <WebuiModelListPanel
            groups={groups}
            selected={selected}
            onSelect={(model) => {
              onChange(qualifiedModelValue(model));
              setOpen(false);
            }}
            {...(defaultLabel
              ? {
                  defaultOption: {
                    label: defaultLabel,
                    active: value === "",
                    onSelect: () => {
                      onChange("");
                      setOpen(false);
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
