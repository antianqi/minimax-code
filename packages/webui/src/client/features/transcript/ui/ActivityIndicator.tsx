// ActivityIndicator — the "thinking…" pulse shown beneath the latest assistant
// stream and inside the streaming placeholders. Class names, testids, the
// sizing algorithm and the phrase-rotation weights are pinned by
// `activity-indicator.test.tsx`.
//
// The phrase rotation weights (basic 0.75 / specific 0.15 / motion 0.1), the
// 2000–3000 ms startup delay followed by 3500 ms swaps, and the avoidance of
// consecutive repeats are all part of that contract. When
// `prefers-reduced-motion: reduce` is on the Lottie playback halts but the
// label keeps ticking.
//
// Playback, lifecycle and reduced-motion handling belong to shared `WebuiLottie`;
// this feature supplies its rose-loader asset and thinking-label behavior.
//
// Phrase vocabulary defaults to the zh i18n bundle (`message.item.thinking_phrases`)
// and falls back to the single string `message.item.thinking`, i.e.
// `g = e ? (r ?? t ?? p ?? (0, h.t)("message.item.thinking")) : null`.
//
// `thinkingPhrases` is overridable so a unit test can pin a deterministic list
// without having to load the i18n bundle; the integration session can pass the
// real one extracted from runtime i18n state.

import { useEffect, useMemo, useRef, useState } from "react";
import streamingRoseLoaderData from "../../../assets/lottie/streaming-rose-loader.json";
import { bucketPhrases, pickWeightedPhrase, computeThinkingPhraseStartDelay } from "../../../ui/activity-phrase.js";
import { WebuiInline } from "../../../ui/layout-primitives.js";
import { WebuiLottie } from "../../../ui/feedback.js";
import type { ThinkingPhraseSet } from "../../../ui/activity-phrase.js";

export const DEFAULT_THINKING_PHRASES: ThinkingPhraseSet = {
  basic: [
    "分析中…",
    "处理中…",
    "推进中…",
    "规划中…",
    "整理中…",
    "构建中…",
    "生成中…",
    "优化中…",
    "调整中…",
    "校准中…",
    "汇总中…",
    "提炼中…",
    "检查中…",
    "完善中…",
    "整合中…",
    "排布中…",
    "归并中…",
    "链接中…",
    "统筹中…",
    "展开中…",
    "补全中…",
    "修正中…",
    "结构化中…",
    "优先排序中…",
  ],
  specific: [
    "梳理结构中…",
    "串联信息中…",
    "逐步补全中…",
    "校验细节中…",
    "优化表达中…",
  ],
  motion: [
    "起势中…",
    "盘旋中…",
    "俯瞰中…",
    "定位中…",
    "调整方向中…",
    "对准中…",
    "轨迹调整中…",
    "定点处理中…",
    "俯冲准备中…",
    "收拢路径中…",
    "孵化中…",
    "降落中…",
    "筑巢中…",
  ],
};

export const DEFAULT_THINKING_PHRASE_FALLBACK = "思考中…";
export const DEFAULT_THINKING_PHRASE_START_DELAY_MIN_MS = 2000;
export const DEFAULT_THINKING_PHRASE_START_DELAY_MAX_MS = 3000;
export const DEFAULT_THINKING_PHRASE_ROTATION_INTERVAL_MS = 3500;

export interface ThinkingPhraseRotationOptions {
  startDelayMinMs?: number;
  startDelayMaxMs?: number;
  rotationIntervalMs?: number;
  phrases?: ThinkingPhraseSet;
  random?: () => number;
}

function useThinkingPhrase(
  active: boolean,
  options: ThinkingPhraseRotationOptions = {},
): string | null {
  const phrases = options.phrases ?? DEFAULT_THINKING_PHRASES;
  const startMin = options.startDelayMinMs ?? DEFAULT_THINKING_PHRASE_START_DELAY_MIN_MS;
  const startMax = options.startDelayMaxMs ?? DEFAULT_THINKING_PHRASE_START_DELAY_MAX_MS;
  const interval = options.rotationIntervalMs ?? DEFAULT_THINKING_PHRASE_ROTATION_INTERVAL_MS;
  const random = options.random ?? Math.random;
  const [value, setValue] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setValue(null);
    if (!active) return undefined;

    const buckets = bucketPhrases(phrases);
    let previous: string | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const next = pickWeightedPhrase(buckets, previous, random);
      previous = next;
      setValue(next);
      timeoutRef.current = setTimeout(tick, interval);
    };

    const startDelay = computeThinkingPhraseStartDelay(startMin, startMax, random);
    timeoutRef.current = setTimeout(tick, startDelay);

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [active, phrases, startMin, startMax, interval, random]);

  return value;
}

export interface ActivityIndicatorProps {
  showLabel?: boolean;
  label?: string;
  labelOverride?: string;
  className?: string;
  iconSizePx?: number;
  pulseMinSizePx?: number;
  pulseMaxSizePx?: number;
  visualScale?: number;
  phrases?: ThinkingPhraseSet;
  phraseFallback?: string;
  "aria-hidden"?: "true" | "false";
}

export function ActivityIndicator(props: ActivityIndicatorProps): React.JSX.Element {
  const {
    showLabel = false,
    label,
    labelOverride,
    className = "",
    iconSizePx = 27,
    pulseMinSizePx,
    pulseMaxSizePx,
    visualScale = 1,
    phrases,
    phraseFallback = DEFAULT_THINKING_PHRASE_FALLBACK,
    "aria-hidden": ariaHidden,
  } = props;

  const containerSize = useMemo(() => {
    if (pulseMinSizePx !== undefined || pulseMaxSizePx !== undefined) {
      return Math.max(
        16,
        Math.ceil(
          Math.max(iconSizePx, pulseMinSizePx ?? iconSizePx, pulseMaxSizePx ?? iconSizePx) *
            visualScale,
        ) + 0,
      );
    }
    return 27;
  }, [iconSizePx, pulseMinSizePx, pulseMaxSizePx, visualScale]);

  const innerSize = Math.ceil(iconSizePx * visualScale);

  const rotated = useThinkingPhrase(showLabel && !label && !labelOverride, {
    ...(phrases ? { phrases } : {}),
  });

  const resolvedLabel = showLabel ? (labelOverride ?? label ?? rotated ?? phraseFallback) : null;

  const containerClass = [
    "flex w-fit max-w-full items-center justify-start gap-[3px] text-left text-[13px] leading-5 tracking-normal text-text_default_tertiary pointer-events-none select-none",
    className,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    <div
      className={containerClass}
      data-testid="streaming-rose-loader"
      aria-hidden={ariaHidden}
    >
      <WebuiInline
        justify="center"
        className="relative shrink-0 overflow-visible"
        style={{
          width: `${containerSize}px`,
          height: `${containerSize}px`,
          minWidth: `${containerSize}px`,
          minHeight: `${containerSize}px`,
        }}
      >
        <WebuiLottie
          play
          loop
          speed={0.8}
          name="streaming-rose-loader"
          data={streamingRoseLoaderData}
          className="h-full w-full"
          style={{ width: `${innerSize}px`, height: `${innerSize}px` }}
        />
      </WebuiInline>
      {resolvedLabel ? (
        <span
          className="min-w-0 truncate text-sm leading-5 text-text_default_tertiary"
          style={{ marginTop: "6px" }}
          data-testid="streaming-rose-loader-label"
        >
          {resolvedLabel}
        </span>
      ) : null}
    </div>
  );
}

export interface MessageViewportStreamingLoaderProps {
  testId: string;
  slot?: React.ReactNode;
}

export function MessageViewportStreamingLoader(
  props: MessageViewportStreamingLoaderProps,
): React.JSX.Element {
  const { testId, slot } = props;
  return (
    <div
      className="mb-4 min-h-9 w-full flow-root pointer-events-none"
      data-testid={testId}
    >
      {slot}
    </div>
  );
}

export function MessageAfterQueryStreamingPlaceholder(): React.JSX.Element {
  return (
    <div
      className="mb-4 min-h-9 w-full flow-root pointer-events-none"
      data-testid="message-after-query-streaming-placeholder"
      aria-hidden="true"
    />
  );
}

export interface MessagePassiveLoadingPlaceholderProps {
  label?: string;
}

// No default for `props`: React's `createElement` always materialises a props
// object (it substitutes `{}` for a missing config), so the `= {}` default was
// unreachable from either call site — `SessionTranscript.tsx` passes `label`,
// and the tests call through `createElement`. Keeping it made the parameter
// type `Props | undefined`, which defeats `createElement`'s `P extends {}`
// inference and pushed `label` onto `Attributes` as an excess property.
export function MessagePassiveLoadingPlaceholder(
  props: MessagePassiveLoadingPlaceholderProps,
): React.JSX.Element {
  const { label } = props;
  return (
    <div
      className="mb-4 min-h-9 w-full flow-root pointer-events-none"
      data-testid={label ? "message-passive-loading-status" : "message-passive-loading-placeholder"}
      aria-hidden={!label}
    >
      {label ? <ActivityIndicator showLabel labelOverride={label} /> : null}
    </div>
  );
}
