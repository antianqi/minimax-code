// The shared block-surface contract (ADR 0028 § Shared contracts).
//
// A card is a surface, not a control: it has no states of its own, only a
// shape. Two businesses drew one — the interaction panel and the composer's
// queue panel — and each of them spelled the shape out of the other one's
// stylesheet, so the surface belonged to nobody in particular.
//
// This module owns the shape; the caller owns the layout, the content and the
// lifetime. A caller that needs another radius or fill says so in
// `className`, and the utilities layer wins over the contract's rule.
//
// It is a component rather than a class name for the same reason the shared
// menu row is: a class name carries no element and no rest attributes, and it
// lets a caller re-derive the recipe the contract owns.

import { createElement, type HTMLAttributes, type ReactElement, type ReactNode } from "react";

export type WebuiCardElement = "div" | "section" | "article" | "aside" | "li";

export interface WebuiCardProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
  /** The element the block is. A card keeps the caller's semantics. */
  readonly as?: WebuiCardElement;
  /** Business-specific hooks or styles only; the surface's shape stays here. */
  readonly className?: string;
  readonly children: ReactNode;
}

/** A block surface in the main column. */
export function WebuiCard({
  as = "div",
  className,
  children,
  ...rest
}: WebuiCardProps): ReactElement {
  return createElement(
    as,
    {
      className: ["webui-card", className].filter(Boolean).join(" "),
      ...rest,
    },
    children,
  );
}
