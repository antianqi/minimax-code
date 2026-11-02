/**
 * The 远程控制 page: the projection and the rendered branches.
 *
 * The page is transcribed from the Desktop 3.1.6 远程控制 tab, so the wording is asserted here
 * rather than eyeballed: the hero, the subtitle, the three feature rows and their order, the
 * 连接 button, the 设置 entry with its accessible name, the two app-store marks and the
 * minimum-version line.
 *
 * The three states are asserted too, because they are the part the Desktop pushes and the WebUI
 * has to get right on its own: an unbound phone shows the hero and the 连接 button, a bound one
 * shows 已连接 and the settings entry alone, and a host that cannot host a phone link shows one
 * title and no card.
 *
 * The live state is asserted as well: a pairing code is shown with the seconds it is still good
 * for, and once that moment has passed the code is not shown at all — a code the server has
 * already forgotten is worse than no code.
 *
 * Rendering goes through `renderToStaticMarkup` — this package has no jsdom.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WebuiRemoteControlSnapshot } from "../../src/client/features/remote-control/application/remote-control-owner.js";
import {
  webuiRemoteControlPanelModel,
  WEBUI_REMOTE_CONTROL_CONNECTED_TITLE,
  WEBUI_REMOTE_CONTROL_FEATURES,
  WEBUI_REMOTE_CONTROL_MINIMUM_VERSION,
  WEBUI_REMOTE_CONTROL_SETTINGS_ARIA_LABEL,
  WEBUI_REMOTE_CONTROL_SETTINGS_LABEL,
  WEBUI_REMOTE_CONTROL_SUBTITLE,
  WEBUI_REMOTE_CONTROL_TITLE,
  WEBUI_REMOTE_CONTROL_UNAVAILABLE_TITLE,
} from "../../src/client/features/remote-control/projection/remote-control-panel.js";
import { RemoteControlPanelView } from "../../src/client/features/remote-control/ui/RemoteControlPanel.public.js";

const NOW_MS = 1_700_000_000_000;

function snapshot(overrides: Partial<WebuiRemoteControlSnapshot> = {}): WebuiRemoteControlSnapshot {
  return { status: "ready", link: { phase: "idle" }, loadedAtMs: NOW_MS, ...overrides };
}

function render(view: React.ReactElement): string {
  return renderToStaticMarkup(view);
}

describe("the remote-control page", () => {
  it("carries the Desktop's copy, in the Desktop's order", () => {
    const model = webuiRemoteControlPanelModel(snapshot(), NOW_MS);

    expect(model.title).toBe("用手机连接你的 MiniMax Code");
    expect(model.subtitle).toBe("通过 MiniMax App 访问此电脑，随时随地继续桌面端的任务");
    expect(model.features.map((feature) => feature.text)).toEqual([
      "手机直接接管电脑上复杂任务，无需守在屏幕前。",
      "对话不断线，进度、指令和审批，手机端随时处理。",
      "遛狗、散步、晒太阳，都可以是你的工作场景。",
    ]);
    expect(model.connectLabel).toBe("连接");
    expect(model.settingsLabel).toBe("设置");
    expect(model.settingsAriaLabel).toBe("打开连接设置");
    expect(model.platformMarks.map((mark) => mark.label)).toEqual(["安卓", "iOS"]);
    expect(model.minimumVersion).toBe("支持移动端 App 4.15.0 及以上版本");
    expect(WEBUI_REMOTE_CONTROL_FEATURES).toHaveLength(3);
    expect(WEBUI_REMOTE_CONTROL_TITLE).toBe(model.title);
    expect(WEBUI_REMOTE_CONTROL_SUBTITLE).toBe(model.subtitle);
    expect(WEBUI_REMOTE_CONTROL_MINIMUM_VERSION).toBe(model.minimumVersion);
  });

  it("renders the hero, the three rows, the button, the settings entry and the version line", () => {
    const markup = render(
      <RemoteControlPanelView
        snapshot={snapshot()}
        nowMs={NOW_MS}
        onConnect={() => {}}
      />,
    );

    expect(markup).toContain("用手机连接你的 MiniMax Code");
    expect(markup).toContain("通过 MiniMax App 访问此电脑，随时随地继续桌面端的任务");
    for (const feature of WEBUI_REMOTE_CONTROL_FEATURES) {
      expect(markup).toContain(feature.text);
    }
    expect(markup).toContain(">连接<");
    expect(markup).toContain(`aria-label="${WEBUI_REMOTE_CONTROL_SETTINGS_ARIA_LABEL}"`);
    expect(markup).toContain(`>${WEBUI_REMOTE_CONTROL_SETTINGS_LABEL}<`);
    expect(markup).toContain("安卓");
    expect(markup).toContain(">iOS<");
    expect(markup).toContain("支持移动端 App 4.15.0 及以上版本");
    // The two dividers between the three rows.
    expect(markup.match(/aria-hidden="true" class="relative h-0 w-full"/gu)).toHaveLength(2);
  });

  it("marks the settings entry disabled rather than silent when nothing can open it", () => {
    const markup = render(
      <RemoteControlPanelView
        snapshot={snapshot()}
        nowMs={NOW_MS}
        onConnect={() => {}}
      />,
    );

    expect(markup).toContain('data-testid="remote-control-settings-entry"');
    expect(markup).toContain('aria-disabled="true"');
  });

  it("carries the platform marks as unavailable, because this host publishes no download code", () => {
    const model = webuiRemoteControlPanelModel(snapshot(), NOW_MS);

    expect(model.platformMarks.every((mark) => !mark.enabled)).toBe(true);

    const markup = render(
      <RemoteControlPanelView
        snapshot={snapshot()}
        nowMs={NOW_MS}
        onConnect={() => {}}
      />,
    );
    expect(markup).toContain('data-testid="rc-platform-android" data-enabled="false"');
    expect(markup).toContain('data-testid="rc-platform-ios" data-enabled="false"');
  });

  it("shows the bound page's title and the settings entry alone", () => {
    const model = webuiRemoteControlPanelModel(
      snapshot({ link: { phase: "connected", displayName: "贾晓源的手机" } }),
      NOW_MS,
    );

    expect(model.state).toBe("bound");
    expect(model.title).toBe(WEBUI_REMOTE_CONTROL_CONNECTED_TITLE);
    expect(model.showsConnectButton).toBe(false);
    expect(model.showsSettingsLink).toBe(true);

    const markup = render(
      <RemoteControlPanelView
        snapshot={snapshot({ link: { phase: "connected", displayName: "贾晓源的手机" } })}
        nowMs={NOW_MS}
        onConnect={() => {}}
      />,
    );
    expect(markup).toContain("已连接");
    expect(markup).not.toContain(">连接<");
    expect(markup).not.toContain("贾晓源的手机");
  });

  it("shows one title and no card when this host cannot host a phone link", () => {
    const model = webuiRemoteControlPanelModel(
      snapshot({ status: "unavailable", error: WEBUI_REMOTE_CONTROL_UNAVAILABLE_TITLE }),
      NOW_MS,
    );

    expect(model.state).toBe("unavailable");
    expect(model.title).toBe(WEBUI_REMOTE_CONTROL_UNAVAILABLE_TITLE);
    expect(model.showsConnectButton).toBe(false);
    expect(model.showsSettingsLink).toBe(false);

    const markup = render(
      <RemoteControlPanelView
        snapshot={snapshot({ status: "unavailable", error: WEBUI_REMOTE_CONTROL_UNAVAILABLE_TITLE })}
        nowMs={NOW_MS}
        onConnect={() => {}}
      />,
    );
    expect(markup).toContain('data-testid="rc-unavailable"');
    expect(markup).not.toContain(">连接<");
  });

  it("shows the pairing code with the seconds it is still good for", () => {
    const model = webuiRemoteControlPanelModel(
      snapshot({
        link: { phase: "pairing", pairingCode: "482913", expiresIn: 60 },
        pairingExpiresAtMs: NOW_MS + 60_000,
      }),
      NOW_MS,
    );

    expect(model.pairingCode).toBe("482913");
    expect(model.pairingExpiresInSeconds).toBe(60);
    expect(model.pairingExpired).toBe(false);
  });

  it("drops the pairing code once its moment has passed", () => {
    const model = webuiRemoteControlPanelModel(
      snapshot({
        link: { phase: "pairing", pairingCode: "482913", expiresIn: 60 },
        pairingExpiresAtMs: NOW_MS + 60_000,
      }),
      NOW_MS + 60_001,
    );

    expect(model.pairingExpired).toBe(true);
    expect(model.pairingCode).toBeUndefined();
  });

  it("reports the bridge's own failure instead of hiding it", () => {
    const model = webuiRemoteControlPanelModel(
      snapshot({
        status: "error",
        link: { phase: "error", lastError: { code: "unauthorized", message: "配对码已失效" } },
        error: "配对码已失效",
      }),
      NOW_MS,
    );

    expect(model.error).toBe("配对码已失效");
    expect(model.phase).toBe("error");
  });
});
