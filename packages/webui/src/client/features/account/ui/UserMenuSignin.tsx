// The daily check-in panel.
//
// It is the menu's check-in surface: the artwork, the streak progress, the credits row and the claim
// button, plus the three copy helpers that turn the owner's answers into the panel's strings. It holds
// no open/closed state and submits nothing itself — the menu owns both, because the two panels are
// mutually exclusive and dismissed together, and that bookkeeping is the menu's.

import { Fragment, useState, type ReactElement } from "react";
import { IconCheck, IconCoin, IconInfoCircle } from "@tabler/icons-react";
import {
  SigninDayStatus,
  SigninPanelScene,
  getCurrentSigninStreak,
  isSigninPanelClaimable,
  isSigninPanelClaimedToday,
} from "@mavis/shared/daily-signin";
import type { WebuiSigninPanelView } from "../../../../shared/contracts/account.js";
import { FeedbackError, WebuiSpinner } from "../../../ui/feedback.js";
import { WebuiButton, WebuiIconButton } from "../../../ui/button.js";
import { WebuiInline } from "../../../ui/layout-primitives.js";
import { WebuiSkeletonProjection, WebuiTooltip } from "../../../ui/page.js";

export interface SigninState {
  readonly loading: boolean;
  readonly panel?: WebuiSigninPanelView;
  readonly claiming: boolean;
  readonly error?: string;
}

/** zh copy, matching the `signin.*` keys the sign-in copy uses. */
export const SIGNIN = {
  title: "每日签到",
  subtitle: "连续签到得更多积分",
  streakBefore: "本轮已连续签到 ",
  streakAfter: " 天",
  claimEarn: "签到得",
  bonusPrefix: "额外",
  claiming: "签到中…",
  claimedToday: "今日已签到",
  unavailable: "暂不可签到",
  error: "签到暂时不可用，请稍后重试",
  invalidResponse: "签到数据暂不可用",
  retry: "重试",
  progress: "签到进度",
  creditsInfo: "签到积分 30 天有效，仅限 MiniMax Code 使用。",
  creditsLink: "查看用量",
  creditsAria: "关于签到积分",
} as const;

function signinStatusText(status: number): string {
  return status === SigninDayStatus.Claimed
    ? "已签到"
    : status === SigninDayStatus.Claimable
      ? "今日可签到"
      : status === SigninDayStatus.Disabled
        ? "不可签到"
        : "未到签到日";
}

function formatSigninPoints(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatSigninError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid sign-in/iu.test(message)
    ? SIGNIN.invalidResponse
    : SIGNIN.error;
}

function SigninInfoIcon(): ReactElement {
  return <IconInfoCircle aria-hidden="true" size={14} stroke={1.7} />;
}

/** Check mark inside a day dot, size 14. */
function SigninCheckIcon(): ReactElement {
  return (
    <IconCheck
      aria-hidden="true"
      className="signin-day-check"
      size={14}
      stroke={1.7}
    />
  );
}

/** Credits glyph in the claim button / bonus tag. */
function SigninCreditsIcon({ size }: { readonly size: number }): ReactElement {
  return <IconCoin aria-hidden="true" size={size} stroke={1.7} />;
}

/** Dotted connector between day dots. */
function SigninConnector({
  className = "",
}: {
  readonly className?: string;
}): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`signin-connector ${className}`}
    >
      <line
        x1="0"
        y1="0.6"
        x2="100%"
        y2="0.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="0 2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Light/dark artwork pair. */
function SigninArtwork({
  lightUrl,
  darkUrl,
  className,
}: {
  readonly lightUrl: string;
  readonly darkUrl: string;
  readonly className?: string;
}): ReactElement {
  const [failed, setFailed] = useState<readonly string[]>([]);
  const dark = darkUrl ?? lightUrl;
  return (
    <div className={className} aria-hidden="true">
      {(
        [
          ["light", lightUrl],
          ["dark", dark],
        ] as const
      ).map(([mode, url]) =>
        !failed.includes(url) ? (
          <img
            key={`${mode}:${url}`}
            src={url}
            alt=""
            draggable={false}
            className={
              mode === "light" ? "block dark:hidden" : "hidden dark:block"
            }
            onError={() => setFailed((list) => [...list, url])}
          />
        ) : null,
      )}
    </div>
  );
}

const LOADING_SIGNIN_PANEL: WebuiSigninPanelView = {
  scene: SigninPanelScene.Unknown,
  days: Array.from({ length: 7 }, (_, index) => ({
    day_no: index + 1,
    points: 0,
    status: SigninDayStatus.Disabled,
    is_today: index === 0,
  })),
};

/** Seven-day progress row. */
function SigninProgress({
  days,
  animatedDay,
}: {
  readonly days: WebuiSigninPanelView["days"];
  readonly animatedDay: number | null;
}): ReactElement {
  const sorted = [...days].sort((left, right) => left.day_no - right.day_no);
  return (
    <div className="signin-progress-scroll">
      <div role="list" aria-label={SIGNIN.progress} className="signin-progress">
        {sorted.map((day, index) => {
          const claimed = day.status === SigninDayStatus.Claimed;
          const claimable = day.status === SigninDayStatus.Claimable;
          const previous = index > 0 ? sorted[index - 1] : undefined;
          const connectorActive =
            previous?.status === SigninDayStatus.Claimed &&
            (claimed || claimable);
          return (
            <Fragment key={day.day_no}>
              {index > 0 ? (
                <SigninConnector
                  className={
                    connectorActive
                      ? "text-text_default_accent opacity-50"
                      : "text-border_default"
                  }
                />
              ) : null}
              <div
                role="listitem"
                data-testid={`signin-day-${day.day_no}`}
                data-status={day.status}
                aria-label={`第 ${day.day_no} 天，${signinStatusText(day.status)}，${formatSigninPoints(day.points)} 积分`}
                aria-current={day.is_today ? "date" : undefined}
                className={`signin-day ${claimed ? "text-text_default_accent opacity-50" : claimable ? "text-text_default_accent" : "text-text_default_tertiary"}`}
              >
                <span
                  aria-hidden="true"
                  className={`signin-day-dot ${claimable ? "bg-text_default_accent text-text_default_inverted_static" : ""} ${claimed && animatedDay === day.day_no ? "signin-day-claimed-animation" : ""}`}
                >
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 22 22"
                    fill="none"
                    className={`signin-day-ring ${claimed || claimable ? "stroke-border_accent" : "stroke-border_default"}`}
                  >
                    <circle cx="11" cy="11" r="10.4" strokeWidth="1.2" />
                  </svg>
                  {claimed || claimable ? <SigninCheckIcon /> : null}
                </span>
                <span
                  aria-hidden="true"
                  data-testid={`signin-day-reward-${day.day_no}`}
                  className="signin-day-points"
                >
                  {formatSigninPoints(day.points)}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/** Title row with the credits-info tooltip trigger. */
function SigninCreditsInfo({
  onNavigateToUsage,
}: {
  readonly onNavigateToUsage: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="webui-signin-credits-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <WebuiIconButton
        tone="bare"
        size="micro"
        label={SIGNIN.creditsAria}
        className="shrink-0"
      >
        <SigninInfoIcon />
      </WebuiIconButton>
      <WebuiTooltip
        as="span"
        visible={open}
        inert={!open}
        role="tooltip"
        className="webui-signin-credits-tooltip"
      >
        <span className="text-xs leading-[18px]">
          <span>{SIGNIN.creditsInfo} </span>
          <WebuiButton
            variant="plain"
            size="inline-dense"
            className="webui-signin-credits-link"
            onClick={() => {
              setOpen(false);
              onNavigateToUsage();
            }}
          >
            {SIGNIN.creditsLink}
          </WebuiButton>
        </span>
      </WebuiTooltip>
    </span>
  );
}

/**
 * The daily check-in card: its DOM, classes and copy.
 *
 * Menu context: `showCloseButton=false`,
 * `autoDismissAfterClaim=false`, `trackView=false`.
 */
export function SigninCard({
  panel,
  loading,
  claiming,
  error,
  animatedDay,
  onClaim,
  onRetry,
  onNavigateToUsage,
}: {
  readonly panel?: WebuiSigninPanelView;
  readonly loading: boolean;
  readonly claiming: boolean;
  readonly error?: string;
  readonly animatedDay: number | null;
  readonly onClaim: () => void;
  readonly onRetry: () => void;
  readonly onNavigateToUsage: () => void;
}): ReactElement {
  const displayPanel = panel ?? (loading ? LOADING_SIGNIN_PANEL : undefined);
  const streak = displayPanel ? getCurrentSigninStreak(displayPanel.days) : 0;
  const today = displayPanel?.days.find((day) => day.is_today);
  const claimableDay =
    displayPanel?.days.find(
      (day) => day.is_today && day.status === SigninDayStatus.Claimable,
    ) ??
    displayPanel?.days.find((day) => day.status === SigninDayStatus.Claimable);
  const claimable = displayPanel ? isSigninPanelClaimable(displayPanel) : false;
  const claimedToday = displayPanel
    ? isSigninPanelClaimedToday(displayPanel)
    : false;
  const bonus = today?.bonus_points ?? 0;
  const points = formatSigninPoints(claimableDay?.points ?? 0);
  const buttonLabel = claiming
    ? SIGNIN.claiming
    : claimedToday
      ? SIGNIN.claimedToday
      : displayPanel && !claimable
        ? SIGNIN.unavailable
        : `${SIGNIN.claimEarn} ${points}`;

  return (
    <WebuiSkeletonProjection loading={loading && !panel}>
      <section
        data-testid={loading && !panel ? "signin-card-skeleton" : "signin-card"}
        aria-label={SIGNIN.title}
        className="signin-card-container"
      >
        <div className="signin-card-surface relative rounded-2xl border-[0.5px] border-border_default bg-bg_grouped_secondary p-3 text-text_default_primary">
          <div className="signin-corner-clip" aria-hidden="true">
            <SigninArtwork
              lightUrl="/assets/img/corner-light.svg"
              darkUrl="/assets/img/corner-dark.svg"
              className="signin-corner-default"
            />
          </div>
          {displayPanel ? (
            <>
              <div className="relative min-h-10 pl-1">
                <WebuiInline
                  gap="tight"
                  align="start"
                  className="min-h-5 pr-20"
                >
                  <h2 className="m-0 min-w-0 text-sm font-medium leading-5 break-words">
                    {SIGNIN.title}
                  </h2>
                  <SigninCreditsInfo onNavigateToUsage={onNavigateToUsage} />
                </WebuiInline>
                {streak > 0 ? (
                  <p
                    data-testid="signin-streak"
                    className="mb-0 mt-1 text-xs leading-4 text-text_default_secondary"
                  >
                    {SIGNIN.streakBefore}
                    <span className="text-text_default_accent">{streak}</span>
                    {SIGNIN.streakAfter}
                  </p>
                ) : (
                  <p className="mb-0 mt-1 text-xs leading-4 text-text_default_secondary">
                    {SIGNIN.subtitle}
                  </p>
                )}
              </div>
              <div className="relative mt-8">
                <SigninProgress
                  days={displayPanel.days}
                  animatedDay={animatedDay}
                />
                <div className="relative mt-7">
                  {claimable ? (
                    <WebuiButton
                      variant="accent"
                      size="regular"
                      className="signin-claim-button h-8 w-full"
                      disabled={claiming}
                      aria-label={buttonLabel}
                      onClick={onClaim}
                    >
                      {claiming ? (
                        <WebuiInline
                          as="span"
                          inline
                          justify="center"
                          gap="micro"
                          className="min-w-0 max-w-full"
                        >
                          <WebuiSpinner />
                          <span className="truncate">{SIGNIN.claiming}</span>
                        </WebuiInline>
                      ) : (
                        <WebuiInline
                          as="span"
                          inline
                          justify="center"
                          gap="micro"
                          className="min-w-0 max-w-full"
                        >
                          <span className="truncate">{SIGNIN.claimEarn}</span>
                          <WebuiInline
                            as="span"
                            inline
                            className="shrink-0"
                            aria-hidden="true"
                          >
                            <SigninCreditsIcon size={16} />
                          </WebuiInline>
                          <span className="shrink-0">{points}</span>
                        </WebuiInline>
                      )}
                    </WebuiButton>
                  ) : (
                    <WebuiButton
                      variant="accent"
                      size="regular"
                      disabled
                      aria-label={buttonLabel}
                      className="signin-claim-button h-8 w-full"
                    >
                      {buttonLabel}
                    </WebuiButton>
                  )}
                  {bonus > 0 ? (
                    <span
                      data-testid="signin-bonus"
                      className="signin-bonus-tag absolute right-0 top-[-9.5px] inline-flex max-w-full items-center gap-0.5 rounded-t-xl rounded-bl-xl bg-bg_interaction_accent_focus_blue px-2 py-0.5 text-xs font-medium leading-4 text-text_default_inverted_static"
                    >
                      <span className="truncate">{SIGNIN.bonusPrefix}</span>
                      <WebuiInline
                        as="span"
                        inline
                        className="shrink-0"
                        aria-hidden="true"
                      >
                        <SigninCreditsIcon size={12} />
                      </WebuiInline>
                      <span className="shrink-0">
                        {formatSigninPoints(bonus)}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
              {error ? (
                <FeedbackError
                  message="error"
                  className="mb-0 mt-2 text-xs text-text_default_secondary"
                />
              ) : null}
            </>
          ) : (
            <FeedbackError
              testId="signin-card-error"
              className="relative mt-8 flex min-h-[104px] flex-col items-center justify-center gap-2 px-4 text-center"
              message={
                <span className="m-0 text-xs leading-4 text-text_default_secondary">
                  {error ?? SIGNIN.error}
                </span>
              }
              action={
                <WebuiButton
                  variant="plain"
                  size="inline-dense"
                  onClick={onRetry}
                  className="webui-signin-retry"
                >
                  {SIGNIN.retry}
                </WebuiButton>
              }
            />
          )}
        </div>
      </section>
    </WebuiSkeletonProjection>
  );
}
