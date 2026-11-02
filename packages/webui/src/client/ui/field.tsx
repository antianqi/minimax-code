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
  useState,
  useId,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { WebuiDropdown } from "./Dropdown.js";
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
    return <WebuiSkeleton variant="shape" className={`webui-page-skeleton-shape ${classes}`} style={props.style} />;
  }
  return <input {...props} ref={ref} className={classes} />;
});

/** The shared multi-line text control. */
export interface WebuiTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "size"> {
  readonly controlSize?: "regular" | "compact" | "large" | "document";
  readonly appearance?: "default" | "document";
  /** Layout only; the control appearance remains owned by this component. */
  readonly className?: string;
}

export const WebuiTextarea = forwardRef<
  HTMLTextAreaElement,
  WebuiTextareaProps
>(function WebuiTextarea({ controlSize = "regular", appearance = "default", className, rows = 12, ...props }, ref): ReactElement {
  if (useWebuiPageLoading()) {
    return <WebuiSkeleton variant="shape" className={`webui-page-skeleton-shape webui-control webui-control--multiline ${controlSize === "compact" ? "webui-control--compact" : ""} ${controlSize === "large" ? "webui-control--large" : ""} ${controlSize === "document" ? "webui-control--document" : ""} ${appearance === "document" ? "webui-control--document-appearance" : ""} ${className ?? ""}`} style={props.style} />;
  }
  return <textarea {...props} rows={rows} ref={ref} className={["webui-control", "webui-motion-feedback", "webui-control--multiline", controlSize === "compact" ? "webui-control--compact" : "", controlSize === "large" ? "webui-control--large" : "", controlSize === "document" ? "webui-control--document" : "", appearance === "document" ? "webui-control--document-appearance" : "", className].filter(Boolean).join(" ")} />;
});

export interface WebuiSelectOption {
  readonly value: string;
  readonly label: string;
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
  const selectIndex = useCallback((index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setActiveIndex(index);
    close();
  }, [close, onChange, options]);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return;
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = (activeIndex + 1) % options.length;
    else if (event.key === "ArrowUp") nextIndex = (activeIndex - 1 + options.length) % options.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) selectIndex(activeIndex);
      else {
        setActiveIndex(selectedIndex);
        setOpen(true);
      }
      return;
    } else return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    if (!open) setOpen(true);
  };
  const selected = options.find((option) => option.value === value);

  return (
    <WebuiDropdown
      open={open}
      onOpen={() => { setActiveIndex(selectedIndex); setOpen(true); }}
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
          aria-activedescendant={open ? optionIds[activeIndex] : undefined}
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
          <button
            key={option.value}
            id={optionIds[index]}
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={`webui-select-menu-option${index === activeIndex ? " is-active" : ""}`}
            onPointerMove={() => setActiveIndex(index)}
            onClick={() => selectIndex(index)}
          >
            {option.label}
          </button>
        ))}
    </WebuiDropdown>
  );
}

export const WebuiCheckbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & { readonly className?: string }
>(function WebuiCheckbox({ className, ...props }, ref): ReactElement {
  if (useWebuiPageLoading()) return <WebuiSkeleton variant="shape" className={`webui-page-skeleton-shape webui-checkbox ${className ?? ""}`} style={props.style} />;
  return <input {...props} ref={ref} type="checkbox" className={["webui-checkbox", "webui-motion-feedback", className].filter(Boolean).join(" ")} />;
});

export const WebuiRadio = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & { readonly className?: string }
>(function WebuiRadio({ className, ...props }, ref): ReactElement {
  if (useWebuiPageLoading()) return <WebuiSkeleton variant="shape" className={`webui-page-skeleton-shape webui-radio ${className ?? ""}`} style={props.style} />;
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
        variant="shape"
        className={`webui-page-skeleton-shape webui-search-field${className ? ` ${className}` : ""}`}
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
}

/** What the field knows that a control may need but must not spread. */
export interface FieldContext {
  /** The id of the label, for a control that points at it with `aria-labelledby`. */
  readonly labelId: string;
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

  // A `<label for>` associates natively (clicking it focuses the control, and the
  // control takes its name from it); the id on the label is what a control that
  // cannot be named by `for` — a button that opens a listbox — points at through
  // `aria-labelledby`.
  const labelText = (
    <label className="webui-field-label" id={labelId} htmlFor={controlId}>
      {label}
      {required ? (
        <span aria-hidden="true" className="webui-field-required">
          {" *"}
        </span>
      ) : null}
    </label>
  );

  const descriptionText = description ? (
    <span className="webui-field-description" id={descriptionId}>
      {description}
    </span>
  ) : null;

  const errorText = error ? (
    // `role="alert"` announces the message when it appears; the control's
    // `aria-describedby` makes it reachable again afterwards.
    <span className="webui-field-error" id={errorId} role="alert">
      {error}
    </span>
  ) : null;

  const props: FieldControlProps = {
    id: controlId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
  };
  const field: FieldContext = { labelId };

  if (arrangement === "row") {
    return (
      <WebuiSkeletonProjection>
      <div className={`webui-field webui-field--gap-${gap} webui-field--row${className ? ` ${className}` : ""}`}>
        <div className="webui-field-text">
          {labelText}
          {descriptionText}
          {errorText}
        </div>
        <div className="webui-field-control">{control(props, field)}</div>
      </div>
      </WebuiSkeletonProjection>
    );
  }

  return (
    <WebuiSkeletonProjection>
    <div className={`webui-field webui-field--gap-${gap}${className ? ` ${className}` : ""}`}>
      {labelText}
      {descriptionText}
      <div className="webui-field-control">{control(props, field)}</div>
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
