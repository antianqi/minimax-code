import type { ReactElement } from "react";
import { WebuiButton } from "../../../ui/button.js";

export function RailRow({
  label,
  icon,
  active,
  onSelect,
  inert,
}: {
  readonly label: string;
  readonly icon?: ReactElement;
  readonly active?: boolean;
  readonly onSelect?: () => void;
  readonly inert?: boolean;
}): ReactElement {
  return (
    <WebuiButton
      variant="selectable-row"
      size="regular"
      onClick={() => onSelect?.()}
      disabled={inert}
      aria-disabled={inert ? "true" : undefined}
      tabIndex={inert ? -1 : undefined}
      aria-current={active ? "page" : undefined}
      /* The shared row owns the fill, the current state and the gap that
       * keeps a filled row from touching the row beside it; the rail owns
       * the row's own geometry and the look of a destination that does not
       * exist yet. */
      className={`webui-nav-item h-8 w-full pl-2 pr-2.5 text-sm font-normal ${inert ? "cursor-not-allowed text-text_default_tertiary opacity-60" : ""}`}
      data-webui-placeholder-chrome={inert ? "rail-nav" : undefined}
      data-webui-nav-item={label}
      data-webui-nav-active={active ? "true" : "false"}
    >
      {icon ? (
        <span className="flex flex-shrink-0 items-center justify-center">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">
        {label}
      </span>
    </WebuiButton>
  );
}
