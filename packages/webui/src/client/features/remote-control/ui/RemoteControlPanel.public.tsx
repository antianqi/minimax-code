// The 远程控制 tab body.
//
// The markup is transcribed from the Desktop 3.1.6 远程控制 tab, measured on the live Desktop
// (its computed styles and rendered markup): the hero, the subtitle, the rounded card with its
// three icon rows and their 1px dividers, the full-width 连接 button, the 设置 entry beneath
// it, and the two app-store marks over the minimum-version line.
//
// ## The three states
//
// The Desktop shows one of three pages, and only the title and the card's action differ:
//
//   unbound      用手机连接你的 MiniMax Code — the card carries 连接 and 设置
//   bound        已连接 / 未连接 / 已绑定 — the card carries 设置 alone
//   unavailable  one title, and no card at all
//
// The bound page carries no device line and no disconnect action: the Desktop keeps the linked
// devices and the revoke action in the connection settings, which 设置 opens.
//
// ## What changed and why
//
//   * The Desktop's `desktop-text-*` typography classes do not exist in the WebUI. Each one is
//     replaced by the size and weight utilities the Desktop's own markup already carries
//     (`text-4xl font-medium leading-[1.2]`, `text-base`, `text-sm`, `text-xs`), so the measured
//     sizes are reproduced with the WebUI's type scale rather than a copy of the Desktop's.
//   * The card's `ring-[0.5px] ring-inset ring-border_default` becomes
//     `border-[0.5px] border-border_default`: the WebUI's Tailwind theme has no `ringColor`
//     entry for the token, and a half-pixel border is the same line.
//   * The three row icons are the WebUI's own glyphs — the phone (`WebuiIconRemote`), the chat
//     bubble (`WebuiIconSession`) and the globe (`WebuiIconGlobe`) — not the Desktop's SVG paths.
//   * The phone mockup column keeps the Desktop's geometry and uses the WebUI's own copy of the
//     same asset (`/assets/img/remote_control_phone_zh.png`, already in `client/assets/img`).
//   * The vertical rhythm is one step that scales with the window's height instead of the
//     Desktop's fixed gaps. The Desktop draws this page in an application window of a fixed
//     height, and its gaps stop fitting in a short browser window: the column then scrolls and
//     the page no longer fits on one screen. At the Desktop's own height every gap is exactly
//     the Desktop's value; below it the gaps close in and the page keeps its shape.
//     `remote-control.css` holds that step.
//   * The phone mockup stretches to the height of the blue frame, as it does on the Desktop, so
//     the frame letterboxes the picture instead of cutting it through.
//
// ## The two pieces
//
// `RemoteControlPanelView` is a pure render of a snapshot: it takes the model and the callbacks
// and nothing else, so a test can assert the page's wording with `renderToStaticMarkup` (this
// package has no jsdom). `RemoteControlPanel` is the thin wrapper that subscribes to the owner
// with `useSyncExternalStore` and hands the view a snapshot. The pairing code is a modal, as it
// is on the Desktop, so it lives in the wrapper: a portal is not something a static markup
// render can carry.
import { Fragment, useEffect, useState, useSyncExternalStore, type ReactElement } from "react";
import { IconBrandAndroid, IconBrandApple } from "@tabler/icons-react";

import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { WebuiIconGlobe, WebuiIconRemote, WebuiIconSession } from "../../../shell/icons.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { FeedbackLiveRegion } from "../../../ui/feedback.js";
import { WebuiInline, WebuiStack } from "../../../ui/layout-primitives.js";
import type {
  createWebuiRemoteControlOwner,
  WebuiRemoteControlSnapshot,
} from "../application/remote-control-owner.js";
import {
  webuiRemoteControlPanelModel,
  type WebuiRemoteControlPanelModel,
} from "../projection/remote-control-panel.js";

export interface RemoteControlPanelViewProps {
  readonly snapshot: WebuiRemoteControlSnapshot;
  /** The clock, so the pairing countdown is placeable in a test. */
  readonly nowMs: number;
  readonly busy?: boolean;
  readonly onConnect: () => void;
  /** Opens the connection settings, the way the Desktop's 设置 entry does. */
  readonly onOpenSettings?: () => void;
}

/** The icon each feature row carries, in the Desktop's order. */
function featureIcon(key: string): ReactElement {
  if (key === "continuous") return <WebuiIconSession className="h-5 w-5" />;
  if (key === "anywhere") return <WebuiIconGlobe className="h-5 w-5" />;
  return <WebuiIconRemote className="h-5 w-5" />;
}

/** The platform mark's glyph, in the Desktop's order. */
function platformGlyph(key: string): ReactElement {
  if (key === "ios") return <IconBrandApple aria-hidden="true" size={14} stroke={1.6} />;
  return <IconBrandAndroid aria-hidden="true" size={14} stroke={1.6} />;
}

/**
 * The pairing page.
 *
 * Everything here is a function of the model, so the same markup serves the unbound page, the
 * bound page and the unavailable page.
 */
export function RemoteControlPanelView(props: RemoteControlPanelViewProps): ReactElement {
  const model = webuiRemoteControlPanelModel(props.snapshot, props.nowMs);
  const settingsDisabled = props.onOpenSettings === undefined;
  return (
    <WebuiInline align="stretch" className="webui-remote-control h-full w-full overflow-hidden">
      <WebuiStack align="center" className="webui-remote-control-column min-w-0 flex-1 overflow-y-auto px-6">
        <WebuiStack align="center" justify="center" className="w-full max-w-[612px] flex-1">
          {model.state === "unavailable" ? (
            <h1
              data-testid="rc-unavailable"
              className="text-center text-4xl font-medium leading-[1.2] text-text_default_primary"
            >
              {model.title}
            </h1>
          ) : (
            <>
              <h1 className="text-center text-4xl font-medium leading-[1.2] text-text_default_primary">
                {model.title}
              </h1>
              <p className="webui-remote-control-subtitle px-6 text-center text-base leading-relaxed text-text_default_secondary">
                {model.subtitle}
              </p>
              <div className="webui-remote-control-card flex w-full max-w-[534px] flex-col items-stretch rounded-3xl border-[0.5px] border-border_default bg-bg_default_primary px-5">
                <WebuiStack gap="large">
                  {model.features.map((feature, index) => (
                    <Fragment key={feature.key}>
                      {index > 0 ? (
                        <div aria-hidden="true" className="relative h-0 w-full">
                          <div
                            className="absolute inset-x-0 top-0 h-px origin-top scale-y-50"
                            style={{ backgroundColor: "var(--border_default)" }}
                          />
                        </div>
                      ) : null}
                      <WebuiInline gap="small" className="h-5">
                        <WebuiInline inline justify="center" className="h-5 w-5 flex-shrink-0 text-icon_default_primary">
                          {featureIcon(feature.key)}
                        </WebuiInline>
                        <span className="text-sm leading-5 text-text_default_primary">{feature.text}</span>
                      </WebuiInline>
                    </Fragment>
                  ))}
                </WebuiStack>
                {model.error ? (
                  <FeedbackLiveRegion
                    className="text-center text-sm text-text_default_secondary"
                    testId="rc-error"
                  >
                    {model.error}
                  </FeedbackLiveRegion>
                ) : null}
                {model.showsConnectButton ? (
                  <WebuiStack gap="medium" align="center" className="w-full">
                    <WebuiButton
                      variant="primary"
                      size="regular"
                      data-testid="rc-connect"
                      onClick={props.onConnect}
                      disabled={props.busy === true || !model.canConnect}
                      className="w-full"
                    >
                      {model.connectLabel}
                    </WebuiButton>
                  </WebuiStack>
                ) : null}
                {model.showsSettingsLink ? (
                  <WebuiInline justify="center" className="w-full">
                    <WebuiButton
                      variant="quiet-highlight"
                      size="inline"
                      className={settingsDisabled ? "cursor-default" : undefined}
                      data-testid="remote-control-settings-entry"
                      aria-label={model.settingsAriaLabel}
                      aria-disabled={settingsDisabled ? "true" : undefined}
                      onClick={settingsDisabled ? undefined : props.onOpenSettings}
                    >
                      {model.settingsLabel}
                    </WebuiButton>
                  </WebuiInline>
                ) : null}
              </div>
            </>
          )}
        </WebuiStack>
        <WebuiStack
          data-testid="rc-version-qr"
          gap="small"
          align="center"
          className="webui-remote-control-marks w-full max-w-[420px]"
        >
          <WebuiInline
            gap="medium"
            className="text-sm"
            role="group"
            aria-label={model.minimumVersion}
          >
            {model.platformMarks.map((mark, index) => (
              <Fragment key={mark.key}>
                {index > 0 ? (
                  <span aria-hidden="true" className="h-3 w-px bg-text_default_quaternary" />
                ) : null}
                <WebuiButton
                  variant="quiet-secondary"
                  size="inline"
                  data-testid={`rc-platform-${mark.key}`}
                  data-enabled={mark.enabled ? "true" : "false"}
                  aria-disabled={mark.enabled ? undefined : "true"}
                  onClick={mark.enabled ? undefined : undefined}
                  className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1.5"
                >
                  {platformGlyph(mark.key)}
                  <span>{mark.label}</span>
                </WebuiButton>
              </Fragment>
            ))}
          </WebuiInline>
          <p className="text-center text-xs text-text_default_tertiary">{model.minimumVersion}</p>
        </WebuiStack>
      </WebuiStack>
      <div className="hidden w-[548px] flex-shrink-0 p-4 lg:block">
        <WebuiInline align="stretch" justify="center" className="h-full w-full overflow-hidden rounded-3xl bg-[#7DC6FF]">
          <img
            src="/assets/img/remote_control_phone_zh.png"
            alt=""
            className="w-[400px] flex-none object-contain"
            style={{ borderRadius: "44px" }}
          />
        </WebuiInline>
      </div>
    </WebuiInline>
  );
}

export interface RemoteControlPanelProps {
  readonly owner: ReturnType<typeof createWebuiRemoteControlOwner>;
  /**
   * The page's 设置 entry raises this; the shell opens the connection settings, the way the
   * Desktop's own entry opens its settings app. Without it the entry renders in the Desktop's
   * markup but disabled — a visible, announced "not yet wired" rather than a button that does
   * nothing.
   */
  readonly onOpenSettings?: () => void;
}

/**
 * The tab body.
 *
 * It subscribes to the owner, reads the link once and then watches it: the phase changes on the
 * host, so the page follows the host's stream rather than polling.
 */
export function RemoteControlPanel(props: RemoteControlPanelProps): ReactElement {
  const { owner } = props;
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [busy, setBusy] = useState(false);
  const model = webuiRemoteControlPanelModel(snapshot, Date.now());
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();
  // The countdown is the one thing on this page that moves without the host saying anything, so
  // the clock ticks only while a code is actually on screen.
  const nowMs = useTickingNow(model.pairingCode !== undefined);

  useEffect(() => {
    void owner.load();
    return owner.startWatching();
  }, [owner]);

  const run = (action: () => Promise<unknown>): void => {
    setBusy(true);
    void action().finally(() => {
      setBusy(false);
    });
  };

  const showPairingCode = model.phase === "pairing" && model.pairingCode !== undefined;

  return (
    <>
      <RemoteControlPanelView
        snapshot={snapshot}
        nowMs={nowMs}
        busy={busy}
        onConnect={() => {
          run(() => owner.connect());
        }}
        {...(props.onOpenSettings === undefined ? {} : { onOpenSettings: props.onOpenSettings })}
      />
      {showPairingCode && portalTarget ? (
        <WebuiDialog
          id="remote-control-pairing"
          open
          title="配对码"
          description="在 MiniMax App 的侧边栏中打开 MiniMax Code，输入配对码。"
          width="standard"
          portalTarget={portalTarget}
          testId="rc-pairing-dialog"
          onClose={() => {
            run(() => owner.disconnect());
          }}
          footer={
            <>
              <WebuiButton
                variant="secondary"
                size="regular"
                data-testid="rc-pairing-cancel"
                onClick={() => {
                  run(() => owner.disconnect());
                }}
              >
                取消
              </WebuiButton>
              <WebuiButton
                variant="primary"
                size="regular"
                data-testid="rc-pairing-refresh"
                disabled={busy}
                onClick={() => {
                  run(() => owner.connect());
                }}
              >
                重新获取
              </WebuiButton>
            </>
          }
        >
          <div className="mb-6 px-5 md:px-0">
            <span
              data-testid="rc-pairing-code"
              className={`font-mono text-[26px] font-semibold tracking-tight leading-[1.23] ${
                model.pairingExpired ? "text-text_default_tertiary" : "text-text_default_primary"
              }`}
            >
              {model.pairingCode ?? "----"}
            </span>
            {model.pairingExpired ? (
              <p className="mt-2.5 text-sm leading-5 text-text_status_error">配对码已过期，请重新获取</p>
            ) : null}
          </div>
        </WebuiDialog>
      ) : null}
    </>
  );
}

/** A clock that ticks while `active`, and stands still otherwise. */
function useTickingNow(active: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return nowMs;
}
