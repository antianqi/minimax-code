import type { ButtonHTMLAttributes, ReactElement } from "react";
import { useWebuiPageLoading, WebuiSkeletonProjection } from "./page.js";
import { FeedbackLoadingOverlay, useFeedbackActionLoading } from "./feedback.js";

type ToggleSwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-checked" | "aria-label" | "onChange" | "role" | "type"
> & {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange?: (checked: boolean) => void | Promise<unknown>;
  readonly testId?: string;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
};

/** Shared switch appearance and semantics for every binary WebUI setting. */
export function ToggleSwitch({
  checked,
  label,
  onChange,
  testId,
  loading = false,
  loadingLabel,
  className,
  disabled = false,
  ...buttonProps
}: ToggleSwitchProps): ReactElement {
  const actionLoading = useFeedbackActionLoading(loading);
  const handleClick = (): void => {
    actionLoading.track(() => onChange?.(!checked));
  };
  if (useWebuiPageLoading()) {
    return <WebuiSkeletonProjection><button type="button" className={`webui-toggle-switch${checked ? " is-checked" : ""}${className ? ` ${className}` : ""}`} style={buttonProps.style}><span aria-hidden="true" /></button></WebuiSkeletonProjection>;
  }
  return (
    <>
      <button
        {...buttonProps}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-busy={actionLoading.loading || undefined}
        data-testid={testId}
        disabled={disabled || actionLoading.loading}
        className={`webui-toggle-switch webui-motion-feedback${checked ? " is-checked" : ""}${className ? ` ${className}` : ""}`}
        onClick={handleClick}
      >
        <span aria-hidden="true" className="webui-motion-feedback" />
      </button>
      <FeedbackLoadingOverlay open={actionLoading.loading} label={loadingLabel} />
    </>
  );
}
