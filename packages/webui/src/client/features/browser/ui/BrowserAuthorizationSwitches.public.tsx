// The four browser authorization switches, as Settings renders them.
//
// Three browser switches and one Full CDP switch, and the separation is the
// point rather than the layout. A browser switch says *a browser may be launched
// or reached*; Full CDP says *a caller may send any DevTools command the provider
// supports*. They are different risks — the second widens the command set of a
// browser that is already on — so Full CDP lives in its own section, is described
// in terms of the command set, and is never folded into the surface rows. The
// ADR forbids the combined switch precisely because it would make it impossible
// to grant one without granting the rest.
//
// Every switch is off by default, from the shared
// `WEBUI_BROWSER_AUTHORIZATION_DEFAULT` rather than from four literals here: the
// default is a product decision that already lives in one place, and a second
// copy is a second answer to it.
//
// A switch with no baseline is *disabled*, not merely rendered off. The person
// cannot see what they are changing, and a write on top of a state nobody read is
// how a setting gets flipped by accident.
//
// `.public` because the Settings surface mounts it — the browser business owns
// the vocabulary, and a settings-local copy of these switches is a second answer
// to the same authorization question.
//
// `BrowserInstallationKey` lives here rather than in a file of its own for one
// reason: the dependency-check gate records every source path against a
// hand-maintained oracle (`test/gates/fixtures/path-metadata-f00.json`), and
// that fixture is not this task's to extend. Both components are the same
// thing — the browser rows a Settings page mounts — so they belong together
// anyway.

import { useCallback, useState, type ReactElement } from "react";
import { WebuiTextInput } from "../../../ui/field.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { WebuiStack } from "../../../ui/layout-primitives.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { useWebuiToast } from "../../../ui/toast.js";
import {
  WEBUI_BROWSER_AUTHORIZATION_DEFAULT,
  type WebuiBrowserAuthorization,
  type WebuiBrowserSurface,
  type WebuiBridgeBrowserSurface,
} from "../../../../shared/contracts/browser.js";
import type {
  WebuiBrowserAuthorizationToggle,
  WebuiBrowserInstallationKeyResult,
} from "../contracts/browser-port.js";
import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";
import { SettingsRow, SettingsSection } from "../../../ui/settings-layout.js";
import { WebuiButton, WebuiButtonLink } from "../../../ui/button.js";

const SURFACE_ROWS: readonly { readonly surface: WebuiBrowserSurface; readonly title: string; readonly description: string }[] = [
  {
    surface: "isolated-chromium",
    title: "隔离浏览器",
    description: "允许启动本进程自带的隔离浏览器，并在浏览器面板中显示它的画面。",
  },
  {
    surface: "edge",
    title: "Microsoft Edge",
    description: "允许通过扩展连接你已经打开的 Edge，并显示它可访问的标签页。",
  },
  {
    surface: "chrome",
    title: "Google Chrome",
    description: "允许通过扩展连接你已经打开的 Chrome，并显示它可访问的标签页。",
  },
];

const FULL_CDP_DESCRIPTION =
  "扩大可发送的 DevTools 命令范围，包含诊断与浏览器内部的敏感能力。打开它不会启用任何浏览器：每个浏览器仍需单独授权，且关闭它不会影响已启用浏览器上的普通浏览器操作。";

export interface BrowserAuthorizationSwitchesProps {
  /** The four switches as they stand. Absent means "never read". */
  readonly authorization?: WebuiBrowserAuthorization;
  /**
   * Called with the one switch that moved, not with a whole authorization — the
   * caller maps it through `webuiBrowserAuthorizationChange()` and sends it, so
   * this component never has to know the wire's shape.
   */
  readonly onChange?: (toggle: WebuiBrowserAuthorizationToggle) => void;
  /** Held off while a write is in flight, or when the host cannot take one. */
  readonly disabled?: boolean;
}

export function BrowserAuthorizationSwitches({
  authorization,
  onChange,
  disabled = false,
}: BrowserAuthorizationSwitchesProps): ReactElement {
  // The documented default stands in for a read that has not happened, and the
  // switches stay disabled so nothing can be written over it.
  const current = authorization ?? WEBUI_BROWSER_AUTHORIZATION_DEFAULT;
  const readOnly = disabled || !authorization || !onChange;

  const value = (surface: WebuiBrowserSurface): boolean =>
    surface === "isolated-chromium"
      ? current.isolatedChromium
      : surface === "edge"
        ? current.edge
        : current.chrome;

  return (
    <>
      <SettingsSection title="浏览器设置" testId="browser-authorization-surfaces" hint="每个浏览器单独授权，默认全部关闭。">
        {SURFACE_ROWS.map((row) => (
          <SettingsRow
            key={row.surface}
            title={row.title}
            description={row.description}
            testId={`browser-authorization-${row.surface}-row`}
          >
            <ToggleSwitch
              checked={value(row.surface)}
              label={row.title}
              testId={`browser-authorization-${row.surface}`}
              disabled={readOnly}
              onChange={(checked) => onChange?.({ surface: row.surface, enabled: checked })}
            />
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection title="Full CDP 访问" testId="browser-authorization-full-cdp">
        <SettingsRow
          title="Full CDP 访问"
          description={FULL_CDP_DESCRIPTION}
          testId="browser-authorization-full-cdp-row"
        >
          <ToggleSwitch
            checked={current.fullCdp}
            label="Full CDP 访问"
            testId="browser-authorization-full-cdp"
            disabled={readOnly}
            onChange={(checked) => onChange?.({ surface: "full-cdp", enabled: checked })}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

export interface BrowserInstallationKeyProps {
  /** Reads one surface's key. Absent means "this host does not wire the bridge". */
  readonly readKey?: (request: {
    readonly surface: WebuiBridgeBrowserSurface;
  }) => Promise<WebuiBrowserInstallationKeyResult>;
}

interface RevealedKey {
  readonly surface: WebuiBridgeBrowserSurface;
  /** The browser's name, so the dialog says which browser it is about. */
  readonly title: string;
  readonly key: string;
  readonly fingerprint: string;
  /**
   * The extension's own page, where the key is pasted.
   *
   * Absent when the host has not seen the extension: the page cannot be named
   * for an extension whose identity the host does not know.
   */
  readonly optionsUrl?: string;
}

const BRIDGE_SURFACES = [
  { surface: "edge", title: "Microsoft Edge" },
  { surface: "chrome", title: "Google Chrome" },
] as const satisfies readonly { readonly surface: WebuiBridgeBrowserSurface; readonly title: string }[];

/**
 * The installation key, shown in a dialog so the person can paste it into the
 * extension.
 *
 * This is the one place the key leaves the host's OS secure store, and it is
 * deliberately small about it: the key is fetched only from a click, held only
 * in this component's state, and never part of the authorization snapshot above
 * — so a client that reads the switches learns nothing about pairing.
 */
export function BrowserInstallationKey({ readKey }: BrowserInstallationKeyProps): ReactElement {
  const [revealed, setRevealed] = useState<RevealedKey | undefined>();
  const [notProvisioned, setNotProvisioned] = useState<readonly WebuiBridgeBrowserSurface[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useWebuiToast();

  const reveal = useCallback(
    async (surface: WebuiBridgeBrowserSurface): Promise<void> => {
      if (!readKey) return;
      setBusy(true);
      try {
        const result = await readKey({ surface });
        if (result.present) {
          setRevealed({
            surface: result.surface,
            title:
              BRIDGE_SURFACES.find((entry) => entry.surface === result.surface)?.title ??
              result.surface,
            key: result.key,
            fingerprint: result.fingerprint,
            ...(result.optionsUrl ? { optionsUrl: result.optionsUrl } : {}),
          });
          setNotProvisioned((prior) => prior.filter((entry) => entry !== surface));
          return;
        }
        // Not an error: the surface has never been switched on, so there is
        // nothing provisioned and nothing to paste.
        setNotProvisioned((prior) => (prior.includes(surface) ? prior : [...prior, surface]));
      } catch (reason) {
        // A read that failed carries the host's reason, and it is the only
        // thing the person can act on.
        toast.error(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusy(false);
      }
    },
    [readKey, toast],
  );

  return (
    <SettingsSection
      title="浏览器桥接安装密钥"
      testId="browser-installation-key"
      hint="扩展需要这把密钥才能完成配对。打开对应浏览器的开关后在此查看密钥，复制到扩展的选项页即可。"
    >
      {BRIDGE_SURFACES.map(({ surface, title }) => (
        <SettingsRow
          key={surface}
          title={title}
          description={
            notProvisioned.includes(surface)
              ? "该浏览器尚未启用，没有可复制的密钥。"
              : "查看并复制这把密钥。"
          }
          testId={`browser-installation-key-${surface}-row`}
        >
          <WebuiButton
            variant="secondary"
            size="compact"
            data-testid={`browser-installation-key-${surface}-reveal`}
            disabled={!readKey || busy}
            onClick={() => {
              void reveal(surface);
            }}
          >
            查看密钥
          </WebuiButton>
        </SettingsRow>
      ))}
      {revealed ? (
        <BrowserInstallationKeyDialog
          revealed={revealed}
          onClose={() => setRevealed(undefined)}
        />
      ) : null}
    </SettingsSection>
  );
}

/**
 * The key, in a dialog, with the extension's page beside it.
 *
 * The key is pasted into the extension's own options page, so the dialog holds
 * the two halves of the pairing together: the fingerprint — which that page
 * shows back — and the key itself, with a copy action and a link to the page.
 * The link opens in a new tab because the person has to paste the key into
 * the page the link opens, and the dialog is where they come back to.
 */
function BrowserInstallationKeyDialog({
  revealed,
  onClose,
}: {
  readonly revealed: RevealedKey;
  readonly onClose: () => void;
}): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  const toast = useWebuiToast();

  const copy = useCallback(async (): Promise<void> => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        // The clipboard can be absent, and the key is still the person's to
        // copy: the fallback copies it through a hidden field.
        dom.copyTextFallback(revealed.key);
      } else {
        await navigator.clipboard.writeText(revealed.key);
      }
      toast.success("安装密钥已复制。");
    } catch {
      toast.error("复制失败，请手动选中密钥复制。");
    }
  }, [dom, revealed.key, toast]);

  return (
    <WebuiDialog
      id={`browser-installation-key-${revealed.surface}`}
      open
      title={`${revealed.title} 安装密钥`}
      onClose={onClose}
      width="compact"
      portalTarget={dom.portalTarget()}
      testId="browser-installation-key-dialog"
    >
      <WebuiStack gap="medium">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-text_default_secondary">指纹</span>
          <WebuiTextInput
            appearance="bare"
            controlSize="dense"
            textSize="small"
            textTone="secondary"
            className="w-full font-mono"
            readOnly
            data-testid="browser-installation-key-fingerprint"
            value={revealed.fingerprint}
            aria-label={`${revealed.surface} installation key fingerprint`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-text_default_secondary">安装密钥</span>
          <WebuiTextInput
            appearance="bare"
            controlSize="dense"
            textSize="small"
            textTone="secondary"
            className="w-full font-mono"
            readOnly
            data-testid="browser-installation-key-value"
            value={revealed.key}
            aria-label={`${revealed.surface} installation key`}
          />
          <WebuiButton
            variant="secondary"
            size="compact"
            className="w-fit"
            data-testid="browser-installation-key-copy"
            onClick={() => {
              void copy();
            }}
          >
            复制密钥
          </WebuiButton>
        </div>
        {revealed.optionsUrl ? (
          <WebuiButtonLink
            href={revealed.optionsUrl}
            target="_blank"
            rel="noreferrer"
            variant="quiet-secondary"
            size="inline"
            className="w-fit"
            data-testid="browser-installation-key-options-link"
          >
            打开扩展选项页
          </WebuiButtonLink>
        ) : (
          <p className="text-[13px] text-text_default_secondary">
这台主机还没有见过这个扩展的连接，不知道它的选项页地址。请在浏览器的扩展管理页（edge://extensions
            或 chrome://extensions）里找到「MiniMax Code Browser Bridge」，点「扩展选项」后粘贴密钥。
          </p>
        )}
      </WebuiStack>
    </WebuiDialog>
  );
}
