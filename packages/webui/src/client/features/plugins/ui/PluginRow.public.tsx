// The plugin row (published to peers).
//
// The miniapp's picker and its list both draw a plugin row, and they drew it
// by spelling this business's class names — `webui-plugin-row`,
// `webui-plugin-list`, `webui-plugin-copy`, `webui-plugin-icon`,
// `webui-plugin-actions` — which made the row's shape another business's to
// change without asking. The row is published here instead: the owner writes
// it once, and a peer renders it.
//
// The slots are the row's shape: the mark, the copy block, and whatever trails
// them — a status line, an action group, a switch. A peer that arranges the
// row differently says so in `className`; the row's own slots stay here.
//
// A row is a presentation, not a control: it decides nothing and holds no
// plugin state of its own. What a plugin IS — installed, enabled, broken —
// belongs to the caller, and it arrives through the slots.

import type { ReactElement, ReactNode } from "react";
import { WebuiMotion } from "../../../ui/page.js";

export interface PluginRowListProps {
  /** The caller's layout only — the list's own arrangement stays here. */
  readonly className?: string;
  readonly children: ReactNode;
}

/** The list the rows sit in. */
export function PluginRowList({ className, children }: PluginRowListProps): ReactElement {
  return (
    <div className={["webui-plugin-list", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export interface PluginRowProps {
  /** Opt in to the shared card hover treatment. */
  readonly hoverable?: boolean;
  /** The caller's layout only — the row's own slots stay here. */
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}

/** One plugin, as a row. */
export function PluginRow({
  hoverable = false,
  className,
  testId,
  children,
}: PluginRowProps): ReactElement {
  const classes = ["webui-plugin-row", className].filter(Boolean).join(" ");
  if (hoverable) {
    return (
      <WebuiMotion
        as="article"
        kind="card"
        hoverable
        className={classes}
        data-testid={testId}
      >
        {children}
      </WebuiMotion>
    );
  }
  return (
    <article className={classes} data-testid={testId}>
      {children}
    </article>
  );
}

export interface PluginRowIconProps {
  /** The mark's own modifier — the skill tile and the picker's icon differ. */
  readonly className?: string;
  readonly children: ReactNode;
}

/** The plugin's mark, in its own tile. Decorative: the copy names the plugin. */
export function PluginRowIcon({ className, children }: PluginRowIconProps): ReactElement {
  return (
    <div
      className={["webui-plugin-icon", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

export interface PluginRowCopyProps {
  readonly className?: string;
  readonly children: ReactNode;
}

/** The row's name and description. */
export function PluginRowCopy({ className, children }: PluginRowCopyProps): ReactElement {
  return (
    <div className={["webui-plugin-copy", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

export interface PluginRowActionsProps {
  readonly className?: string;
  readonly children: ReactNode;
}

/** What the row can be done to. */
export function PluginRowActions({ className, children }: PluginRowActionsProps): ReactElement {
  return (
    <div className={["webui-plugin-actions", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
