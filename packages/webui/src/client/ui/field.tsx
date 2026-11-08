// The field contract (ADR 0028 § Shared contracts, #288).
//
// A field is a label, a description, a validation error and one control, and the
// four are connected by id and ARIA rather than placed near each other. The
// connection is the contract: a label that merely sits above an input leaves a
// screen reader announcing "edit text" with no name, and an error that merely
// sits below one is never announced at all.
//
// What belongs here: the wiring. What does not: submission, validation rules,
// pending and dirty state, and the business command behind the control. Those
// stay with the caller, which is why `control` is a render function — the caller
// owns the element, this owns the ids and the attributes that point at it.

import {
  forwardRef,
  useCallback,
  useMemo,
  useState,
  useId,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { WebuiDropdown, WebuiTriggerRegionContext } from "./Dropdown.js";
import { useWebuiPageLoading, WebuiSkeleton, WebuiSkeletonProjection } from "./page.js";

/** The shared single-line text control. Appearance belongs to the field family. */
export interface WebuiTextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  readonly controlSize?: "regular" | "compact" | "dense";
  readonly appearance?: "boxed" | "bare";
  readonly textSize?: "small" | "regular" | "large";
  readonly textTone?: "primary" | "secondary";
  /** Layout only; the control appearance remains owned by this component. */
  readonly className?: string;
}

export const WebuiTextInput = forwardRef<HTMLInputElement, WebuiTextInputProps>(function WebuiTextInput(
  { controlSize = "regular", appearance = "boxed", textSize = "regular", textTone = "primary", className, ...props },
  ref,
): ReactElement {
  const classes = [
    "webui-control",
    "webui-motion-feedback",
    controlSize === "compact" ? "webui-control--compact" : "",
    controlSize === "dense" ? "webui-control--dense" : "",
    appearance === "bare" ? "webui-control--bare" : "",
    textSize !== "regular" ? `webui-control--text-${textSize}` : "",
    textTone === "secondary" ? "webui-control--text-secondary" : "",
    className,
  ].filter(Boolean).join(" ");
  if (useWebuiPageLoading()) {
    return <WebuiSkeleton />;
  }
  return <input {...props} ref={ref} className={classes} />;
});

/** The shared multi-line text control. */
export interface WebuiTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "size"> {
  readonly controlSize?: "regular" | "compact" | "large" | "document";
  readonly appearance?: "default" | "document";
  readonly textSize?: "small" | "regular" | "large";
  /** Layout only; the control appearance remains owned by this component. */
  readonly className?: string;
}

export const WebuiTextarea = forwardRef<
  HTMLTextAreaElement,
  WebuiTextareaProps
>(function WebuiTextarea({ controlSize = "regular", appearance = "default", textSize = "regular", className, rows = 12, ...props }, ref): ReactElement {
  if (useWebuiPageLoading()) {
    return <WebuiSkeleton />;
  }
  return <textarea {...props} rows={rows} ref={ref} className={["webui-control", "webui-motion-feedback", "webui-control--multiline", controlSize === "compact" ? "webui-control--compact" : "", controlSize === "large" ? "webui-control--large" : "", controlSize === "document" ? "webui-control--document" : "", appearance === "document" ? "webui-control--document-appearance" : "", textSize !== "regular" ? `webui-control--text-${textSize}` : "", className].filter(Boolean).join(" ")} />;
});

export interface WebuiSelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The active option, brought back into the list.
 *
 * The list can change under an open popup — the form behind it reloads its
 * choices, the field loses its last one — and an index past the end would
 * leave the trigger naming an option that is not in the document.
 */
export function clampWebuiSelectIndex(index: number, optionCount: number): number {
  if (optionCount <= 0) return 0;
  return Math.min(Math.max(index, 0), optionCount - 1);
}

/** What the select's keyboard knows at a moment. */
export interface WebuiSelectKeyboardState {
  /** The option the trigger names. */
  readonly activeIndex: number;
  /** Whether the option list is open. */
  readonly open: boolean;
}

/** What one key does to the select. */
export interface WebuiSelectKeyboardOutcome {
  /** The option the trigger names afterwards. */
  readonly activeIndex: number;
  /** Whether the list is open afterwards. */
  readonly open: boolean;
  /** The option the key chose, when it chose one. */
  readonly chosenIndex: number | undefined;
  /** Whether the key belongs to the select at all. */
  readonly handled: boolean;
}

/**
 * The select's keyboard, as a decision.
 *
 * The trigger holds the DOM focus and names the active option with
 * `aria-activedescendant`; the options are not in the tab order and are not
 * focusable at all. The control used to answer the keyboard two ways at once —
 * a trigger with an active descendant AND tabbable option buttons — so Tab
 * walked into the list while the trigger still claimed the focus, and the two
 * answers disagreed about where the user was.
 *
 * So: Arrow, Home and End move the active option; Enter and Space take it;
 * Escape closes; Tab leaves the control, and the list closes behind it
 * because nothing in it holds a focus of its own.
 *
 * The decision is kept apart from the renderer so it can be exercised
 * without a document: a key that no option can answer — an empty list — is
 * answered by nothing at all, and a list that shrank under the open popup
 * cannot leave the trigger naming an option that is gone.
 */
export function reduceWebuiSelectKeyboard(
  state: WebuiSelectKeyboardState,
  key: string,
  optionCount: number,
  selectedIndex: number,
): WebuiSelectKeyboardOutcome {
  const unchanged: WebuiSelectKeyboardOutcome = {
    ...state,
    chosenIndex: undefined,
    handled: false,
  };
  if (optionCount <= 0) return unchanged;
  const activeIndex = clampWebuiSelectIndex(state.activeIndex, optionCount);
  if (key === "ArrowDown") {
    return { activeIndex: (activeIndex + 1) % optionCount, open: true, chosenIndex: undefined, handled: true };
  }
  if (key === "ArrowUp") {
    return { activeIndex: (activeIndex - 1 + optionCount) % optionCount, open: true, chosenIndex: undefined, handled: true };
  }
  if (key === "Home") {
    return { activeIndex: 0, open: true, chosenIndex: undefined, handled: true };
  }
  if (key === "End") {
    return { activeIndex: optionCount - 1, open: true, chosenIndex: undefined, handled: true };
  }
  if (key === "Enter" || key === " ") {
    return state.open
      ? { activeIndex, open: false, chosenIndex: activeIndex, handled: true }
      : { activeIndex: clampWebuiSelectIndex(selectedIndex, optionCount), open: true, chosenIndex: undefined, handled: true };
  }
  if (key === "Escape") {
    return { activeIndex, open: false, chosenIndex: undefined, handled: true };
  }
  if (key === "Tab") {
    return { activeIndex, open: false, chosenIndex: undefined, handled: true };
  }
  return unchanged;
}

/** A shared select whose option surface is rendered by the WebUI. */
export interface WebuiSelectMenuProps extends FieldControlProps {
  readonly options: readonly WebuiSelectOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly labelId: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly "aria-label"?: string;
}

export function WebuiSelectMenu({
  options,
  value,
  onChange,
  labelId,
  disabled = false,
  className,
  ...attributes
}: WebuiSelectMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const optionIdPrefix = useId();
  const optionIds = options.map((_, index) => `${optionIdPrefix}-option-${index}`);
  const close = useCallback(() => setOpen(false), []);
  /**
   * The active option is always one that exists: the list can change under an
   * open popup, and an index past the end would leave the trigger naming an
   * option that is not in the document.
   */
  const activeOptionIndex = clampWebuiSelectIndex(activeIndex, options.length);
  const selectIndex = useCallback((index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    close();
  }, [close, onChange, options]);
  /**
   * The keyboard, answered by the shared decision.
   *
   * The rules themselves live in `reduceWebuiSelectKeyboard`, so they can be
   * exercised without a document; this is the wiring: a key the decision
   * answers moves the active option and opens or closes the list, a key it
   * chooses with takes the option, and a key that is none of its business is
   * left to the page.
   */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const outcome = reduceWebuiSelectKeyboard(
      { activeIndex: activeOptionIndex, open },
      event.key,
      options.length,
      selectedIndex,
    );
    if (!outcome.handled) return;
    // Tab and Escape are not the select's to swallow: Tab moves the focus on
    // and Escape is the dropdown's own dismissal.
    if (event.key !== "Tab" && event.key !== "Escape") event.preventDefault();
    if (outcome.chosenIndex !== undefined) {
      selectIndex(outcome.chosenIndex);
      return;
    }
    if (outcome.activeIndex !== activeOptionIndex) setActiveIndex(outcome.activeIndex);
    if (outcome.open !== open) setOpen(outcome.open);
  };
  const selected = options.find((option) => option.value === value);

  return (
    <WebuiDropdown
      open={open}
      onOpen={() => {
        // A list with nothing in it is not a list: the popup stays closed, so
        // the trigger never claims to have opened one.
        if (options.length === 0) return;
        setActiveIndex(selectedIndex);
        setOpen(true);
      }}
      onClose={close}
      role="listbox"
      managed
      triggerHasPopup="listbox"
      labelledBy={labelId}
      width="match"
      className="webui-select-menu-options"
      wrapperClassName="webui-select-menu"
      trigger={(triggerProps) => (
        <button
          {...attributes}
          type="button"
          id={attributes.id}
          ref={triggerProps.ref}
          role="combobox"
          aria-labelledby={attributes["aria-label"] ? undefined : labelId}
          aria-label={attributes["aria-label"]}
          aria-describedby={attributes["aria-describedby"]}
          aria-invalid={attributes["aria-invalid"]}
          aria-activedescendant={open ? optionIds[activeOptionIndex] : undefined}
          aria-expanded={triggerProps["aria-expanded"]}
          aria-controls={triggerProps["aria-controls"]}
          aria-haspopup="listbox"
          disabled={disabled}
          className={["webui-control", "webui-motion-feedback", "webui-select-menu-trigger", className].filter(Boolean).join(" ")}
          onClick={() => {
            triggerProps.onClick();
            if (!open) setActiveIndex(selectedIndex);
          }}
          onKeyDown={(event) => {
            triggerProps.onKeyDown(event);
            handleKeyDown(event);
          }}
        >
          <span>{selected?.label ?? ""}</span>
          <span className="webui-select-menu-chevron" aria-hidden="true" />
        </button>
      )}
    >
      {options.map((option, index) => (
          // An option is not a control: the trigger is the control, and it
          // names the active option. A focusable option would give the
          // keyboard a second answer, and a click on one would take the focus
          // off the trigger — so the press is answered without moving it.
          <div
            key={option.value}
            id={optionIds[index]}
            role="option"
            aria-selected={option.value === value}
            className={`webui-select-menu-option${index === activeOptionIndex ? " is-active" : ""}`}
            onPointerMove={() => setActiveIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectIndex(index)}
          >
            {option.label}
          </div>
        ))}
    </WebuiDropdown>
  );
}

export const WebuiCheckbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & { readonly className?: string }
>(function WebuiCheckbox({ className, ...props }, ref): ReactElement {
  if (useWebuiPageLoading()) return <WebuiSkeleton />;
  return <input {...props} ref={ref} type="checkbox" className={["webui-checkbox", "webui-motion-feedback", className].filter(Boolean).join(" ")} />;
});

export const WebuiRadio = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & { readonly className?: string }
>(function WebuiRadio({ className, ...props }, ref): ReactElement {
  if (useWebuiPageLoading()) return <WebuiSkeleton />;
  return <input {...props} ref={ref} type="radio" className={["webui-radio", "webui-motion-feedback", className].filter(Boolean).join(" ")} />;
});

/** A visually hidden native file picker, triggered by its owning surface's button. */
export const WebuiFileInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">
>(function WebuiFileInput(props, ref): ReactElement {
  return <input {...props} ref={ref} type="file" className="webui-file-input" />;
});

export interface WebuiSearchFieldProps {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly onChange: NonNullable<InputHTMLAttributes<HTMLInputElement>["onChange"]>;
  readonly placeholder?: string;
  /** Surface placement only; the search control's appearance stays shared. */
  readonly className?: string;
  readonly inputClassName?: string;
  readonly trailing?: ReactNode;
  readonly testId?: string;
  readonly id?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly onKeyDown?: InputHTMLAttributes<HTMLInputElement>["onKeyDown"];
  readonly [attribute: `data-${string}`]: string | undefined;
}

/** A labelled search control with the shared icon, field and focus-within treatment. */
export function WebuiSearchField({
  icon,
  label,
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  trailing,
  testId,
  id,
  inputRef,
  onKeyDown,
  ...dataAttributes
}: WebuiSearchFieldProps): ReactElement {
  if (useWebuiPageLoading()) {
    return (
      <WebuiSkeleton
        testId={testId}
      />
    );
  }
  return (
    <div
      className={`webui-search-field${className ? ` ${className}` : ""}`}
    >
      {icon ? <span className="webui-search-field-icon" aria-hidden="true">{icon}</span> : null}
      <WebuiTextInput
        appearance="bare"
        controlSize="dense"
        className={`webui-search-field-control${inputClassName ? ` ${inputClassName}` : ""}`}
        id={id}
        ref={inputRef}
        role="searchbox"
        aria-label={label}
        data-testid={testId}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        {...dataAttributes}
      />
      {trailing ? <span className="webui-search-field-trailing">{trailing}</span> : null}
    </div>
  );
}

/**
 * The attributes the contract owns. Every key here is a DOM attribute, so a
 * caller can spread the object onto an element as it is. The label's own id is
 * passed separately (`FieldContext`) because a control that spreads these props
 * would otherwise forward `labelId` to the DOM, which React rejects.
 */
export interface FieldControlProps {
  /** The id the label points at. */
  readonly id: string;
  /** Present when the field carries a description and/or an error. */
  readonly "aria-describedby"?: string;
  /** Present only while the field carries an error. */
  readonly "aria-invalid"?: true;
  /** Present when the field is required, including for custom controls. */
  readonly "aria-required"?: true;
}

/** What the field knows that a control may need but must not spread. */
export interface FieldContext {
  /** The id of the label, for a control that points at it with `aria-labelledby`. */
  readonly labelId: string;
}

export interface WebuiRequiredField {
  /** Stable field key used by `WebuiField.error`. */
  readonly name: string;
  readonly label: string;
  readonly value: string | undefined | null;
  readonly required?: boolean;
  readonly message?: string;
}

export type WebuiFieldErrors = Readonly<Record<string, string>>;

export function WebuiRequiredMark(): ReactElement {
  return <span aria-hidden="true" className="webui-field-required">{" *"}</span>;
}

/** The shared inline error for a grouped control that is not one native input. */
export function WebuiFieldError({ id, message }: { readonly id?: string; readonly message: string }): ReactElement {
  return <span className="webui-field-error" id={id} role="alert">{message}</span>;
}

/** Build the same field-level empty-value errors for every WebUI form. */
export function validateWebuiRequiredFields(
  fields: readonly WebuiRequiredField[],
): WebuiFieldErrors {
  return Object.fromEntries(fields
    .filter((field) => field.required !== false && (field.value ?? "").trim() === "")
    .map((field) => [field.name, field.message ?? `${field.label}不能为空。`]));
}

/** Shared required-field validation state; domain-specific validation stays with the form. */
export function useWebuiFormValidation(): {
  readonly errors: WebuiFieldErrors;
  readonly validateRequired: (fields: readonly WebuiRequiredField[]) => boolean;
  readonly setFieldError: (name: string, message: string) => void;
  readonly clearFieldError: (name: string) => void;
  readonly clearErrors: () => void;
} {
  const [errors, setErrors] = useState<WebuiFieldErrors>({});
  const validateRequired = useCallback((fields: readonly WebuiRequiredField[]) => {
    const next = validateWebuiRequiredFields(fields);
    setErrors(next);
    return Object.keys(next).length === 0;
  }, []);
  const setFieldError = useCallback((name: string, error: string) => {
    setErrors((current) => ({ ...current, [name]: error }));
  }, []);
  const clearFieldError = useCallback((name: string) => {
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);
  const clearErrors = useCallback(() => setErrors({}), []);
  return { errors, validateRequired, setFieldError, clearFieldError, clearErrors };
}

export interface WebuiFieldProps {
  readonly label: string;
  readonly description?: string;
  readonly error?: string;
  readonly required?: boolean;
  /** Shared label-to-control spacing; callers select a named step, never a CSS value. */
  readonly gap?: "compact" | "small";
  /**
   * How the label, the description and the error sit against the control.
   *
   * `stacked` puts the label above the control — a form that asks for several
   * things in sequence. `row` puts the label and the description on the left and
   * the control on the right — a settings row that changes one thing in place.
   * The two are arrangements of the same field, not two different fields.
   */
  readonly arrangement?: "stacked" | "row";
  readonly className?: string;
  readonly control: (props: FieldControlProps, field: FieldContext) => ReactNode;
}

/**
 * One field: label, optional description, optional error, and the control.
 *
 * The description and the error are both reachable from the control through
 * `aria-describedby`, in that order, so a reader hears what the field is for
 * before it hears what is wrong with it.
 */
export function WebuiField({
  label,
  description,
  error,
  required = false,
  gap = "compact",
  arrangement = "stacked",
  className,
  control,
}: WebuiFieldProps): ReactElement {
  const base = useId();
  const controlId = `${base}-control`;
  const labelId = `${base}-label`;
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  /**
   * The region the control may claim.
   *
   * A dropdown that is this field's control owns the label as well: the label
   * names the trigger, and a press on it has to reach the trigger rather than
   * dismiss the popup the trigger opened. The control claims the region and
   * the field marks the label with the layer the control registered under.
   */
  const [regionLayerId, setRegionLayerId] = useState<string | null>(null);
  const claimRegion = useCallback((layerId: string) => setRegionLayerId(layerId), []);
  const region = useMemo(() => ({ claim: claimRegion }), [claimRegion]);

  // A `<label for>` associates natively (clicking it focuses the control, and the
  // control takes its name from it); the id on the label is what a control that
  // cannot be named by `for` — a button that opens a listbox — points at through
  // `aria-labelledby`.
  const labelText = (
    <label className="webui-field-label" id={labelId} htmlFor={controlId} data-overlay-layer={regionLayerId ?? undefined}>
      {label}
      {required ? <WebuiRequiredMark /> : null}
    </label>
  );

  const descriptionText = description ? (
    <span className="webui-field-description" id={descriptionId}>
      {description}
    </span>
  ) : null;

  // `role="alert"` announces the message when it appears; the control's
  // `aria-describedby` makes it reachable again afterwards.
  const errorText = error ? <WebuiFieldError id={errorId} message={error} /> : null;

  const props: FieldControlProps = {
    id: controlId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(required ? { "aria-required": true as const } : {}),
  };
  const field: FieldContext = { labelId };

  const controlSlot = (
    <WebuiTriggerRegionContext.Provider value={region}>
      <div className="webui-field-control">{control(props, field)}</div>
    </WebuiTriggerRegionContext.Provider>
  );

  if (arrangement === "row") {
    return (
      <WebuiSkeletonProjection>
      <div className={`webui-field webui-field--gap-${gap} webui-field--row${className ? ` ${className}` : ""}`}>
        <div className="webui-field-text">
          {labelText}
          {descriptionText}
          {errorText}
        </div>
        {controlSlot}
      </div>
      </WebuiSkeletonProjection>
    );
  }

  return (
    <WebuiSkeletonProjection>
    <div className={`webui-field webui-field--gap-${gap}${className ? ` ${className}` : ""}`}>
      {labelText}
      {descriptionText}
      {controlSlot}
      {errorText}
    </div>
    </WebuiSkeletonProjection>
  );
}

/** The arrangement of several fields inside one form. */
export function WebuiFormLayout({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  return <div className={`webui-form${className ? ` ${className}` : ""}`}><WebuiSkeletonProjection>{children}</WebuiSkeletonProjection></div>;
}

/** A two-column form group whose fields share the same available width. */
export function WebuiFormGrid({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  return <div className={`webui-form-grid webui-form-grid--two${className ? ` ${className}` : ""}`}><WebuiSkeletonProjection>{children}</WebuiSkeletonProjection></div>;
}

/** The actions a form ends with. The commands stay with the caller. */
export function WebuiFormActions({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  return <div className={`webui-form-actions${className ? ` ${className}` : ""}`}><WebuiSkeletonProjection>{children}</WebuiSkeletonProjection></div>;
}
