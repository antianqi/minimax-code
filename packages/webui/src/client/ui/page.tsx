import {
  Children,
  cloneElement,
  createContext,
  createElement,
  forwardRef,
  Fragment,
  isValidElement,
  useEffect,
  useState,
  type AnimationEvent,
  useContext,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

const PageLoadingContext = createContext(false);

function projectSkeleton(node: ReactNode): ReactNode {
  return Children.map(node, (child, index) => {
    if (child === null || child === undefined || typeof child === "boolean")
      return null;
    if (typeof child === "string" || typeof child === "number") {
      const width = `${Math.min(92, Math.max(18, String(child).length * 4))}%`;
      return (
        <WebuiSkeleton key={`text-${index}`} variant="text" width={width} />
      );
    }
    if (!isValidElement<HTMLAttributes<HTMLElement>>(child)) return child;
    if (child.type === Fragment) {
      return cloneElement(child, {
        children: projectSkeleton(child.props.children),
      });
    }
    if (typeof child.type !== "string") return child;
    if (child.type === "svg" || child.type === "img") {
      return (
        <WebuiSkeleton
          key={child.key}
          variant="shape"
          className={`webui-page-skeleton-shape ${child.props.className ?? ""}`}
          style={skeletonLayoutStyle(child.props.style)}
        />
      );
    }
    const nested = child.props.children;
    if (nested === undefined || nested === null) {
      const variant = ["button", "input", "select", "textarea"].includes(
        child.type,
      )
        ? "control"
        : "shape";
      return (
        <WebuiSkeleton
          key={child.key}
          variant={variant}
          className={`webui-page-skeleton-shape ${child.props.className ?? ""}`}
          style={skeletonLayoutStyle(child.props.style)}
        />
      );
    }
    const skeletonControl =
      child.type === "button" ||
      child.type === "a" ||
      child.props.role === "button";
    return cloneElement(child, {
      "aria-hidden": true,
      ...(skeletonControl
        ? { "data-webui-page-skeleton-control": "true" }
        : {}),
      className: [
        child.props.className,
        "webui-page-skeleton-node",
        skeletonControl ? "webui-motion-loading" : "",
      ]
        .filter(Boolean)
        .join(" "),
      children: projectSkeleton(nested),
    });
  });
}

export type WebuiPageElement = "article" | "aside" | "button" | "div" | "main" | "section";

export interface WebuiPageProps extends HTMLAttributes<HTMLElement> {
  readonly inert?: boolean;
  readonly as?: WebuiPageElement;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  /** Keep a page-like surface mounted while hiding it with shared motion. */
  readonly visible?: boolean;
  /** Keep a page-like surface mounted until its shared exit animation ends. */
  readonly present?: boolean;
  readonly kind?: "content" | "dialog" | "drawer" | "panel" | "settings";
  readonly motion?: {
    readonly kind: WebuiMotionKind;
    readonly state?: WebuiMotionState;
    readonly direction?: WebuiMotionDirection;
  };
  readonly type?: "button" | "reset" | "submit";
  readonly onExitComplete?: () => void;
  readonly className?: string;
  readonly children?: ReactNode;
}

/** A page-like presentation boundary. Layout and business state stay with its caller. */
export const WebuiPage = forwardRef<HTMLElement, WebuiPageProps>(
  function WebuiPage(
    {
      as = "main",
      loading = false,
      loadingLabel = "正在加载",
      visible = true,
      present = true,
      kind = "content",
      motion,
      className,
      children,
      onAnimationEnd,
      onExitComplete,
      inert,
      ...attributes
    },
    ref,
  ): ReactElement | null {
    const [mounted, setMounted] = useState(present);
    const hasExitAnimation =
      motion?.kind === "card" ||
      motion?.kind === "panel" ||
      motion?.kind === "surface";
    useEffect(() => {
      if (present) setMounted(true);
      else if (!hasExitAnimation) setMounted(false);
    }, [hasExitAnimation, present]);
    if (!mounted) return null;
    const exiting = !present;
    const hidden = !visible || exiting || Boolean(inert);
    const handleAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
      onAnimationEnd?.(event);
      if (
        event.target === event.currentTarget &&
        exiting &&
        hasExitAnimation
      ) {
        setMounted(false);
        onExitComplete?.();
      }
    };
    const setPageRef = (element: HTMLElement | null) => {
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
      element?.toggleAttribute("inert", hidden);
    };
    return (
      <PageLoadingContext.Provider value={loading}>
        {createElement(
          as,
          {
            ...attributes,
            ref: setPageRef,
            "aria-busy": loading || attributes["aria-busy"] || undefined,
            "aria-hidden": hidden ? true : attributes["aria-hidden"],
            onAnimationEnd: handleAnimationEnd,
            style:
              exiting && motion?.kind === "panel"
                ? {
                    ...attributes.style,
                    flexBasis: 0,
                    minWidth: 0,
                    overflow: "hidden",
                    pointerEvents: "none",
                    width: 0,
                  }
                : attributes.style,
            "data-webui-page": kind,
            "data-webui-page-visible": kind === "drawer" ? String(visible) : undefined,
            "data-webui-page-loading": loading ? "true" : undefined,
            ...(motion === undefined
              ? {}
              : {
                  "data-webui-motion": motion.kind,
                  "data-webui-motion-state": exiting ? "exit" : motion.state,
                  "data-webui-motion-direction": motion.direction ?? "down",
                }),
            className: [
              "webui-page",
              motion === undefined ? "" : "webui-motion",
              className,
            ]
              .filter(Boolean)
              .join(" "),
          },
          <>
            {loading ? (
              <span className="webui-page-loading-status" role="status">
                {loadingLabel}
              </span>
            ) : null}
            {loading ? projectSkeleton(children) : children}
          </>,
        )}
      </PageLoadingContext.Provider>
    );
  },
);

export function useWebuiPageLoading(): boolean {
  return useContext(PageLoadingContext);
}

/** Project the children a shared structural component owns while its page is loading. */
export function WebuiSkeletonProjection({
  children,
  loading: loadingOverride,
}: {
  readonly children: ReactNode;
  readonly loading?: boolean;
}): ReactElement {
  const pageLoading = useWebuiPageLoading();
  const loading = loadingOverride ?? pageLoading;
  return (
    <PageLoadingContext.Provider value={loading}>
      {loading ? projectSkeleton(children) : children}
    </PageLoadingContext.Provider>
  );
}

export type WebuiMotionKind =
  | "card"
  | "disclosure"
  | "panel"
  | "range"
  | "sortable"
  | "surface"
  | "tooltip";
export type WebuiMotionState = "collapse" | "enter" | "expand" | "exit";
export type WebuiMotionDirection = "down" | "left" | "none" | "right" | "up";

export type WebuiMotionSlotKind =
  | "disclosure"
  | "disclosure-transform"
  | "feedback"
  | "feedback-clip"
  | "feedback-opacity"
  | "panel-layout"
  | "progress";

export interface WebuiMotionSlotProps {
  readonly children: ReactElement<{ readonly className?: string }>;
  readonly className?: string;
  readonly kind: WebuiMotionSlotKind;
  readonly rotation?: -90 | 0 | 90 | 180;
}

const WEBUI_MOTION_SLOT_CLASSES: Record<WebuiMotionSlotKind, string> = {
  disclosure: "webui-motion-disclosure",
  "disclosure-transform": "webui-motion-disclosure-transform",
  feedback: "webui-motion-feedback",
  "feedback-clip": "webui-motion-feedback-clip",
  "feedback-opacity": "webui-motion-feedback-opacity",
  "panel-layout": "webui-motion-panel-layout",
  progress: "webui-motion-progress",
};

const WEBUI_DISCLOSURE_ROTATION_CLASSES: Record<Exclude<WebuiMotionSlotProps["rotation"], undefined>, string> = {
  [-90]: "is-rotated-minus-90",
  0: "",
  90: "is-rotated-90",
  180: "is-rotated-180",
};

/** Apply shared motion to an existing semantic element without adding a DOM wrapper. */
export function WebuiMotionSlot({
  children,
  className,
  kind,
  rotation = 0,
}: WebuiMotionSlotProps): ReactElement {
  const motionClass = WEBUI_MOTION_SLOT_CLASSES[kind];
  const rotationClass =
    kind !== "disclosure-transform" || rotation === 0
      ? ""
      : WEBUI_DISCLOSURE_ROTATION_CLASSES[rotation];
  return cloneElement(children, {
    className: [children.props.className, motionClass, rotationClass, className]
      .filter(Boolean)
      .join(" "),
  });
}

export interface WebuiMotionProps extends HTMLAttributes<HTMLElement> {
  readonly inert?: boolean;
  readonly as?: "article" | "aside" | "div" | "section" | "span";
  readonly kind: WebuiMotionKind;
  readonly state?: WebuiMotionState;
  readonly direction?: WebuiMotionDirection;
  readonly hoverable?: boolean;
  /** A reusable semantic role within a motion family, such as a range thumb. */
  readonly motionRole?: "thumb" | "track";
}

/** Apply a shared motion family to an existing semantic surface. */
export const WebuiMotion = forwardRef<HTMLElement, WebuiMotionProps>(
  function WebuiMotion(
    {
      as = "div",
      kind,
      state,
      direction = "down",
      hoverable = false,
      motionRole,
      className,
      children,
      inert,
      ...attributes
    },
    ref,
  ): ReactElement {
    const setMotionRef = (element: HTMLElement | null) => {
      if (typeof ref === "function") ref(element);
      else if (ref) ref.current = element;
      element?.toggleAttribute("inert", Boolean(inert));
    };
    return createElement(
      as,
      {
        ...attributes,
        ref: setMotionRef,
        "data-webui-motion": kind,
        ...(state === undefined ? {} : { "data-webui-motion-state": state }),
        ...(motionRole === undefined ? {} : { "data-webui-motion-role": motionRole }),
        "data-webui-motion-direction": direction,
        ...(kind === "card"
          ? { "data-webui-motion-hoverable": hoverable ? "true" : undefined }
          : {}),
        className: ["webui-motion", className].filter(Boolean).join(" "),
      },
      <WebuiSkeletonProjection>{children}</WebuiSkeletonProjection>,
    );
  },
);

export interface WebuiTooltipProps extends Omit<WebuiMotionProps, "kind" | "state"> {
  readonly visible: boolean;
}

/** A tooltip with shared visibility, accessibility and motion behavior. */
export const WebuiTooltip = forwardRef<HTMLElement, WebuiTooltipProps>(
  function WebuiTooltip(
    {
      as = "span",
      visible,
      className,
      inert,
      "aria-hidden": ariaHidden,
      ...attributes
    },
    ref,
  ): ReactElement {
    return (
      <WebuiMotion
        {...attributes}
        as={as}
        kind="tooltip"
        ref={ref}
        data-webui-tooltip-visible={visible ? "true" : "false"}
        aria-hidden={ariaHidden ?? !visible}
        inert={inert ?? !visible}
        className={["webui-tooltip-bubble", className]
          .filter((entry) => Boolean(entry && entry.length > 0))
          .join(" ")}
      />
    );
  },
);

export interface WebuiDisclosureProps extends Omit<WebuiMotionProps, "kind" | "state"> {
  readonly open: boolean;
  readonly axis?: "horizontal" | "vertical";
  /** Mount content on first open, then retain it for the shared exit transition. */
  readonly mountOnOpen?: boolean;
}

/** A disclosure whose layout animation and hidden-state behavior are shared. */
export const WebuiDisclosure = forwardRef<HTMLElement, WebuiDisclosureProps>(
  function WebuiDisclosure(
    {
      as = "div",
      open,
      axis = "vertical",
      mountOnOpen = false,
      className,
      children,
      style,
      ...attributes
    },
    ref,
  ): ReactElement {
    const [hasOpened, setHasOpened] = useState(open);
    useEffect(() => {
      if (open) setHasOpened(true);
    }, [open]);
    const hidden =
      !open ||
      attributes["aria-hidden"] === true ||
      attributes["aria-hidden"] === "true" ||
      attributes.inert === true;
    const disclosureStyle = {
      ...style,
      ...(axis === "horizontal" && !open
        ? {
            borderInlineStartWidth: 0,
            flexBasis: 0,
            minWidth: 0,
            overflow: "hidden",
            width: 0,
          }
        : {}),
    };
    const content = <div className="webui-disclosure-content">{!mountOnOpen || hasOpened || open ? children : null}</div>;
    return (
      <WebuiMotion
        {...attributes}
        as={as}
        ref={ref}
        kind="disclosure"
        state={open ? "expand" : "collapse"}
        direction="none"
        data-webui-disclosure-axis={axis}
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
        style={disclosureStyle}
        className={className}
      >
        {content}
      </WebuiMotion>
    );
  },
);

export type WebuiSkeletonVariant =
  "circle" | "control" | "rect" | "shape" | "text";

const SKELETON_VARIANT_CLASS: Record<WebuiSkeletonVariant, string> = {
  circle: "webui-skeleton--circle",
  control: "webui-skeleton--control",
  rect: "webui-skeleton--rect",
  shape: "webui-skeleton--shape",
  text: "webui-skeleton--text",
};

export interface WebuiSkeletonProps {
  readonly variant?: WebuiSkeletonVariant;
  readonly width?: string | number;
  readonly height?: string | number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
}

const SKELETON_LAYOUT_PROPERTIES = new Set([
  "aspectRatio",
  "blockSize",
  "flex",
  "flexBasis",
  "gridArea",
  "gridColumn",
  "gridRow",
  "height",
  "inlineSize",
  "justifySelf",
  "margin",
  "marginBlock",
  "marginBlockEnd",
  "marginBlockStart",
  "marginBottom",
  "marginInline",
  "marginInlineEnd",
  "marginInlineStart",
  "marginLeft",
  "marginRight",
  "marginTop",
  "maxBlockSize",
  "maxHeight",
  "maxInlineSize",
  "maxWidth",
  "minBlockSize",
  "minHeight",
  "minInlineSize",
  "minWidth",
  "width",
]);

function skeletonLayoutStyle(style?: CSSProperties): CSSProperties | undefined {
  if (!style) return undefined;
  const layout = Object.fromEntries(
    Object.entries(style).filter(([property]) =>
      SKELETON_LAYOUT_PROPERTIES.has(property),
    ),
  ) as CSSProperties;
  return Object.keys(layout).length === 0 ? undefined : layout;
}

function cssLength(value: string | number): string {
  return typeof value === "number" ? `${value}px` : value;
}

/** Shared skeleton shape and pulse. Callers supply geometry, never animation rules. */
export function WebuiSkeleton({
  variant = "text",
  width,
  height,
  className,
  style: inheritedStyle,
  testId,
}: WebuiSkeletonProps): ReactElement {
  const style: CSSProperties = {
    ...inheritedStyle,
    ...(width === undefined ? {} : { inlineSize: cssLength(width) }),
    ...(height === undefined ? {} : { blockSize: cssLength(height) }),
  };
  return (
    <span
      aria-hidden="true"
      className={[
        "webui-skeleton",
        "webui-motion-loading",
        SKELETON_VARIANT_CLASS[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      style={style}
    />
  );
}

/** A common group for a page body whose data has not arrived yet. */
export function WebuiSkeletonGroup({
  rows = 3,
  className,
}: {
  readonly rows?: number;
  readonly className?: string;
}): ReactElement {
  return (
    <div
      aria-hidden="true"
      className={["webui-skeleton-group", className].filter(Boolean).join(" ")}
    >
      {Array.from({ length: Math.max(0, rows) }, (_, index) => (
        <WebuiSkeleton
          key={index}
          variant="text"
          className={index === rows - 1 ? "webui-skeleton--short" : undefined}
        />
      ))}
    </div>
  );
}
