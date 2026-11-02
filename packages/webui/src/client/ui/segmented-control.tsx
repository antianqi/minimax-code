import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement } from "react";

import { WebuiButton } from "./button.js";
import { WebuiRadio } from "./field.js";
import { WebuiMotionSlot } from "./page.js";

export interface WebuiSegmentedControlOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
}

export interface WebuiSegmentedControlProps<Value extends string = string> {
  readonly options: readonly WebuiSegmentedControlOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly ariaLabel: string;
  readonly mode?: "pressed" | "radio";
  /**
   * The track's size recipe.
   *
   * `default` is the compact strip. `page-header` is the strip the Desktop puts in a page
   * header, measured on the live Desktop's `ant-segmented mavis-segmented-page-header`: a 30px
   * track with 2px padding and 2px gaps, and 26px items at 14px/21px. The two recipes differ in
   * geometry only — they share the same track fill and the same selected fill, which are the
   * `--bg_grouped_primary` and `--bg_grouped_secondary` roles.
   */
  readonly variant?: "default" | "page-header";
  readonly className?: string;
  readonly testId?: string;
  readonly itemTestIdPrefix?: string;
}

interface IndicatorPosition {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A shared compact selector with button or native-radio semantics. */
export function WebuiSegmentedControl<Value extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  mode = "pressed",
  variant = "default",
  className,
  testId,
  itemTestIdPrefix,
}: WebuiSegmentedControlProps<Value>): ReactElement {
  const radioName = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<Value, HTMLElement>());
  const [indicatorPosition, setIndicatorPosition] = useState<IndicatorPosition | null>(null);
  const rootClassName = [
    "webui-segmented-control",
    variant === "page-header" ? "webui-segmented-control--page-header" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    const root = rootRef.current;
    const selectedOption = optionRefs.current.get(value);
    if (!root || !selectedOption) return;

    const measure = () => {
      const rootBounds = root.getBoundingClientRect();
      const optionBounds = selectedOption.getBoundingClientRect();
      setIndicatorPosition({
        x: optionBounds.left - rootBounds.left,
        y: optionBounds.top - rootBounds.top,
        width: optionBounds.width,
        height: optionBounds.height,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(selectedOption);
    return () => observer.disconnect();
  }, [value]);

  const indicatorStyle: CSSProperties | undefined = indicatorPosition
    ? {
        transform: `translate(${indicatorPosition.x}px, ${indicatorPosition.y}px)`,
        width: indicatorPosition.width,
        height: indicatorPosition.height,
      }
    : undefined;

  const indicator = indicatorPosition ? (
    <WebuiMotionSlot kind="feedback">
      <span
        aria-hidden="true"
        className="webui-segmented-control__indicator"
        style={indicatorStyle}
      />
    </WebuiMotionSlot>
  ) : null;

  if (mode === "radio") {
    return (
      <div
        ref={rootRef}
        role="radiogroup"
        aria-label={ariaLabel}
        className={rootClassName}
        data-testid={testId}
      >
        {indicator}
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <WebuiMotionSlot key={option.value} kind="feedback">
              <label
                ref={(node) => {
                  if (node) optionRefs.current.set(option.value, node);
                  else optionRefs.current.delete(option.value);
                }}
                className={`webui-segmented-control__radio-option${selected ? " is-selected" : ""}`}
                data-testid={itemTestIdPrefix ? `${itemTestIdPrefix}-${option.value}` : undefined}
                data-selected={selected ? "true" : "false"}
              >
                <WebuiRadio
                  name={radioName}
                  checked={selected}
                  onChange={() => onChange(option.value)}
                  className="webui-segmented-control__radio"
                />
                <span title={option.label}>{option.label}</span>
              </label>
            </WebuiMotionSlot>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={ariaLabel}
      className={rootClassName}
      data-testid={testId}
    >
      {indicator}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <WebuiButton
            key={option.value}
            ref={(node) => {
              if (node) optionRefs.current.set(option.value, node);
              else optionRefs.current.delete(option.value);
            }}
            variant="plain"
            size="compact"
            className={`webui-segmented-control__button-option${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            data-testid={itemTestIdPrefix ? `${itemTestIdPrefix}-${option.value}` : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </WebuiButton>
        );
      })}
    </div>
  );
}
