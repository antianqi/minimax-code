// The connection settings' remote-control device list.
//
// The Desktop keeps the linked devices and the revoke action in the connection settings
// (设置 > 连接), not on the 远程 page: the page's 设置 entry opens that settings tab, and this
// module is what the tab shows there.
//
// It is the Desktop's "控制这台电脑" half. The other half — the devices this computer controls —
// belongs to a build that can drive another machine, and this runtime is a host only, so it is
// not offered here.
//
// The rows are real: the runtime owns the link, so the list reads it, the 添加 action starts the
// pairing and 撤销访问 drops the binding. The pending-unbind confirmation is the Desktop's own:
// the phone asked to be let go, and the producer has to confirm it with the server.
import { useEffect, useState, useSyncExternalStore, type ReactElement } from "react";

import { useWebuiRemoteControlOwner } from "../../../bindings/remote-control-owner-context.js";
import { WebuiIconRemote } from "../../../shell/icons.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiInline, WebuiStack } from "../../../ui/layout-primitives.js";

/** The Desktop's copy for the device list. */
export const WEBUI_REMOTE_CONTROL_DEVICES_ADD_TITLE = "添加设备";
export const WEBUI_REMOTE_CONTROL_DEVICES_ADD_DESCRIPTION = "添加设备以控制这台电脑";
export const WEBUI_REMOTE_CONTROL_DEVICES_ADD_ACTION = "添加";
export const WEBUI_REMOTE_CONTROL_DEVICES_REVOKE = "撤销访问";
export const WEBUI_REMOTE_CONTROL_DEVICES_CONNECTED = "当前已连接";
export const WEBUI_REMOTE_CONTROL_DEVICES_NOT_CONNECTED = "未连接";
export const WEBUI_REMOTE_CONTROL_DEVICES_UNKNOWN = "连接状态暂不可用";
export const WEBUI_REMOTE_CONTROL_DEVICES_FALLBACK_NAME = "已连接的移动设备";
export const WEBUI_REMOTE_CONTROL_DEVICES_UNBIND_PENDING = "解绑处理中，正在与服务器确认…";

/**
 * The list, for the settings tab.
 *
 * It reads the owner the shell provides. Without a wired host it says so, rather than drawing
 * an empty list that reads as "no device is linked".
 */
export function RemoteControlDevices(): ReactElement | null {
  const owner = useWebuiRemoteControlOwner();
  const snapshot = useSyncExternalStore(
    owner?.subscribe ?? noopSubscribe,
    owner?.getSnapshot ?? emptySnapshot,
    owner?.getSnapshot ?? emptySnapshot,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!owner) return;
    void owner.load();
    return owner.startWatching();
  }, [owner]);

  if (!owner) {
    return (
      <p className="px-4 py-3 text-sm text-text_default_tertiary" data-testid="rc-devices-unavailable">
        这个运行时无法托管手机远程控制（宿主没有远程控制能力）。
      </p>
    );
  }

  const linked = snapshot.link?.phase === "connected" || snapshot.link?.phase === "connecting" ||
    snapshot.link?.phase === "reconnecting";
  const deviceName = snapshot.link?.displayName?.trim() || WEBUI_REMOTE_CONTROL_DEVICES_FALLBACK_NAME;
  const stateLabel =
    snapshot.link?.phase === "connected"
      ? WEBUI_REMOTE_CONTROL_DEVICES_CONNECTED
      : snapshot.link?.phase === "reconnecting"
        ? WEBUI_REMOTE_CONTROL_DEVICES_NOT_CONNECTED
        : WEBUI_REMOTE_CONTROL_DEVICES_UNKNOWN;

  const run = (action: () => Promise<unknown>): void => {
    setBusy(true);
    void action().finally(() => {
      setBusy(false);
    });
  };

  return (
    <div className="flex flex-col gap-3 pt-3" data-testid="rc-devices">
      <section>
        <div className="flex flex-col">
          <div className="flex flex-col rounded-2xl bg-bg_grouped_tertiary p-1">
            {linked ? (
              <div
                className="flex w-full items-center gap-6 overflow-hidden rounded-xl py-2 pl-3 pr-2"
                data-testid="rc-device-row"
              >
                <WebuiInline gap="small" className="min-w-0 flex-1 items-center">
                  <WebuiIconRemote className="h-5 w-5 shrink-0 text-icon_default_primary" />
                  <WebuiStack gap="tight" className="min-w-0">
                    <span className="truncate text-sm text-text_default_primary">{deviceName}</span>
                    <span className="text-xs text-text_default_secondary">{stateLabel}</span>
                  </WebuiStack>
                </WebuiInline>
                <WebuiButton
                  variant="secondary"
                  size="regular"
                  data-testid="rc-device-revoke"
                  disabled={busy}
                  onClick={() => {
                    run(() => owner.disconnect({ unbind: true }));
                  }}
                  className="h-9 min-w-20 shrink-0 px-3 py-0 font-medium"
                >
                  {WEBUI_REMOTE_CONTROL_DEVICES_REVOKE}
                </WebuiButton>
              </div>
            ) : (
              <div
                className="flex w-full items-center gap-3 rounded-xl p-3"
                data-testid="rc-device-add"
              >
                <WebuiInline gap="small" className="min-w-0 flex-1 items-center">
                  <WebuiIconRemote className="h-5 w-5 shrink-0 text-icon_default_primary" />
                  <WebuiStack gap="tight" className="min-w-0 flex-1">
                    <span className="text-[14px] font-[430] leading-[21px] text-text_default_primary">
                      {WEBUI_REMOTE_CONTROL_DEVICES_ADD_TITLE}
                    </span>
                    <span className="text-[14px] font-[430] leading-[21px] text-text_default_secondary">
                      {WEBUI_REMOTE_CONTROL_DEVICES_ADD_DESCRIPTION}
                    </span>
                  </WebuiStack>
                </WebuiInline>
                <WebuiButton
                  variant="secondary"
                  size="header"
                  data-testid="rc-device-add-action"
                  disabled={busy}
                  onClick={() => {
                    run(() => owner.connect());
                  }}
                  className="min-w-20 shrink-0"
                >
                  {WEBUI_REMOTE_CONTROL_DEVICES_ADD_ACTION}
                </WebuiButton>
              </div>
            )}
          </div>
          {snapshot.pendingUnbind ? (
            <div
              className="mt-3 rounded-xl border-[0.5px] border-border_default p-3"
              data-testid="rc-device-unbind-pending"
            >
              <p className="text-sm text-text_default_primary">
                {WEBUI_REMOTE_CONTROL_DEVICES_UNBIND_PENDING}
              </p>
              <WebuiInline gap="small" className="mt-2">
                <WebuiButton
                  variant="danger"
                  size="inline"
                  data-testid="rc-device-unbind-confirm"
                  onClick={() => {
                    run(() => owner.resolveUnbind(true));
                  }}
                >
                  确认解绑
                </WebuiButton>
                <WebuiButton
                  variant="quiet-highlight"
                  size="inline"
                  data-testid="rc-device-unbind-reject"
                  onClick={() => {
                    run(() => owner.resolveUnbind(false));
                  }}
                >
                  取消
                </WebuiButton>
              </WebuiInline>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function noopSubscribe(): () => void {
  return () => undefined;
}

function emptySnapshot(): never {
  throw new Error("the remote-control owner is not wired");
}
