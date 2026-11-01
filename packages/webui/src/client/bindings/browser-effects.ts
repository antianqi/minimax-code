// Browser interaction effects: moving focus and the scroll position, and the
// element id a source line is rendered under.
//
// It issues no business request: the callers decide which line to reveal, and
// these functions only move the viewport and the keyboard focus.
//
// Boundary: this file owns focus/scroll effects and the shared reduced-motion
// policy for programmatic scrolling.

export interface WebuiFileLineTarget {
  focus(options?: FocusOptions): void;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
}

export interface WebuiScrollTarget {
  scrollIntoView(options?: ScrollIntoViewOptions): void;
}

/** Resolve the shared smooth-scroll policy before invoking a browser effect. */
export function webuiScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? "instant" : "smooth";
}

/** Scroll one browser target with the package-wide reduced-motion policy. */
export function scrollWebuiTargetIntoView(
  target: WebuiScrollTarget,
  options: Omit<ScrollIntoViewOptions, "behavior">,
): void {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ ...options, behavior: webuiScrollBehavior(prefersReducedMotion) });
}

/** Move keyboard focus and the scroll position to the requested source line. */
export function focusWebuiFileLine(target: WebuiFileLineTarget): void {
  scrollWebuiTargetIntoView(target, { block: "center" });
  target.focus({ preventScroll: true });
}

export function webuiFileLineTargetId(tabId: string, line: number): string {
  return `webui-file-line-${encodeURIComponent(tabId)}-${line}`;
}
