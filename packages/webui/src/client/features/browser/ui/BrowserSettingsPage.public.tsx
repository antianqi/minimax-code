// The browser settings page.
//
// The four switches and the bridge installation key used to hang under the
// browser panel, in the tool area. They are settings, and a setting that lives
// in a panel is a setting nobody finds without opening that panel first — so
// they moved to the Settings page, where the rest of the person's preferences
// already live.
//
// The page belongs to the browser business and is published, because the
// browser family owns the vocabulary: what a surface is, what Full CDP widens,
// and what the bridge key pairs with. The settings page mounts this; it does
// not restate what a switch means, because a second copy of that copy is a
// second answer to the same question.
//
// The owner is the browser family's, and it is the same owner the panel reads:
// a switch moved here reaches the panel in the tool area without the panel
// re-reading the host.

import { useCallback, useEffect, type ReactElement } from "react";

import { SettingsPage, SettingsRow, SettingsSection } from "../../../ui/settings-layout.js";
import { WebuiButtonLink } from "../../../ui/button.js";
import { useWebuiPortSlice } from "../../../bindings/port-slices-context.js";
import {
  useWebuiBrowserAuthorization,
  useWebuiBrowserAuthorizationState,
} from "../bindings/use-browser-authorization.public.js";
import type { WebuiBrowserAuthorizationToggle } from "../contracts/browser-port.js";
import {
  BrowserAuthorizationSwitches,
  BrowserInstallationKey,
} from "./BrowserAuthorizationSwitches.public.js";

export function BrowserSettingsPage(): ReactElement {
  const owner = useWebuiBrowserAuthorization();
  const state = useWebuiBrowserAuthorizationState();
  // The package is the host's, and the host knows where it is: the port builds
  // the URL because only it knows the token the route checks.
  const packageUrl = useWebuiPortSlice("browser")?.browserExtensionPackageUrl?.();

  // The read is the owner's, and it is asked for once per mount: a second
  // caller re-reads the same answer rather than keeping a second copy of it.
  useEffect(() => {
    void owner?.load();
  }, [owner]);

  const onChange = useCallback(
    (toggle: WebuiBrowserAuthorizationToggle): void => {
      void owner?.toggle(toggle);
    },
    [owner],
  );

  // Absent until a read lands. A switch with no baseline is disabled rather
  // than rendered off: an off switch says the host says so, and here nobody
  // has said anything yet.
  const authorization = state?.status === "ready" ? state.authorization : undefined;
  const disabled = state === undefined || !state.canWrite || state.pending;

  return (
    <SettingsPage testId="content-body">
      <BrowserAuthorizationSwitches
        authorization={authorization}
        onChange={onChange}
        disabled={disabled}
      />
      <BrowserInstallationKey
        readKey={state?.canReadInstallationKey && owner ? owner.readInstallationKey : undefined}
      />
      <BrowserExtensionPackage packageUrl={packageUrl} />
    </SettingsPage>
  );
}

/**
 * The extension package, as the settings page offers it.
 *
 * The browser will not install an extension for the person: a store install
 * needs their own click, and an unpacked install needs developer mode and a
 * folder they pick. What the host can do is hand them the package this build
 * produces, so the extension they load is one this build can talk to — a
 * mismatch between the two reads like a network timeout and costs an
 * afternoon.
 *
 * The link opens in a new tab on purpose. A download that succeeds leaves the
 * page alone, and one that fails opens the host's own refusal beside it
 * rather than replacing the settings the person was reading.
 */
function BrowserExtensionPackage({
  packageUrl,
}: {
  readonly packageUrl?: string;
}): ReactElement {
  return (
    <SettingsSection
      title="浏览器扩展包"
      testId="browser-extension-package"
      hint="扩展由你手动加载，浏览器不会替人安装。"
    >
      <SettingsRow
        title="下载最新扩展包"
        description={
          packageUrl
            ? "下载这个构建对应的扩展包，解压后在浏览器的扩展管理页用「加载已解压的扩展程序」加载它。换个目录加载会改变扩展的身份，需要用新的安装密钥重新配对。"
            : "当前运行时没有随附浏览器扩展，没有可下载的扩展包。"
        }
        testId="browser-extension-package-row"
      >
        {packageUrl ? (
          <WebuiButtonLink
            href={packageUrl}
            download
            target="_blank"
            rel="noreferrer"
            variant="quiet-secondary"
            size="inline"
            data-testid="browser-extension-package-download"
          >
            下载最新扩展包
          </WebuiButtonLink>
        ) : (
          <span data-testid="browser-extension-package-unavailable">不可用</span>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
