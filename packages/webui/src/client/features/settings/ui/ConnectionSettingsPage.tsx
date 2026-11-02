// The Desktop's 「设置 > 连接」 page.
//
// The Desktop splits the page in three and the split is the page: 控制这台电脑 (the phone that
// drives this computer), 控制其他设备 (the devices this computer drives) and SSH (the hosts this
// computer reaches over SSH). The tab strip and the three bodies are one surface, so the page
// owns the tab and every body comes from the business that owns it — the remote-control
// business for the two device halves, the SSH business for the hosts.
//
// The Desktop's third half has no counterpart in this client: driving another machine is a
// capability this runtime does not have, so that body keeps the Desktop's shape with its command
// disabled rather than pretending the device can be added.
import { useState, type ReactElement } from "react";
import { IconDeviceDesktop } from "@tabler/icons-react";

import { RemoteControlDevices } from "../../remote-control/ui/RemoteControlDevices.public.js";
import { SshPanel } from "../../ssh/ui/SshPanel.public.js";
import { useWebuiSshOwner } from "../../../bindings/ssh-owner-context.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiInline, WebuiStack } from "../../../ui/layout-primitives.js";

export type WebuiConnectionSection = "this-device" | "other-devices" | "ssh";

/** The Desktop's three tabs, in its order. */
export const WEBUI_CONNECTION_SECTIONS: readonly {
  readonly value: WebuiConnectionSection;
  readonly label: string;
}[] = [
  { value: "this-device", label: "控制这台电脑" },
  { value: "other-devices", label: "控制其他设备" },
  { value: "ssh", label: "SSH" },
];

/** The Desktop's copy for the controlled-devices half. */
export const WEBUI_CONNECTION_CONTROLLED_DEVICES_TITLE = "通过这台电脑控制的设备";
export const WEBUI_CONNECTION_CONTROLLED_DEVICES_EMPTY = "尚未添加设备";
export const WEBUI_CONNECTION_CONTROLLED_DEVICES_UNAVAILABLE =
  "在支持的设备上完成配对后，可从当前桌面端继续其他设备上的任务。";

export interface ConnectionSettingsPageProps {
  /** The tab the page opens on. */
  readonly initialSection?: WebuiConnectionSection;
}

export function ConnectionSettingsPage(props: ConnectionSettingsPageProps): ReactElement {
  const [section, setSection] = useState<WebuiConnectionSection>(props.initialSection ?? "this-device");
  const sshOwner = useWebuiSshOwner();

  return (
    <div className="flex w-full flex-col gap-3" data-testid="connection-settings">
      <div className="flex items-center gap-1" role="tablist" aria-label="连接">
        {WEBUI_CONNECTION_SECTIONS.map((item) => {
          const selected = item.value === section;
          return (
            <WebuiButton
              key={item.value}
              variant="plain"
              size="compact"
              role="tab"
              aria-selected={selected}
              className={`flex h-8 items-center justify-center rounded-lg px-3 text-[13px] font-medium ${
                selected
                  ? "bg-bg_interaction_tertiary_selected text-text_default_primary"
                  : "text-text_default_secondary hover:bg-bg_interaction_tertiary_hover"
              }`}
              data-testid={`connection-section-${item.value}`}
              onClick={() => setSection(item.value)}
            >
              {item.label}
            </WebuiButton>
          );
        })}
      </div>
      <div role="tabpanel" aria-label="连接">
        {section === "this-device" ? <RemoteControlDevices /> : null}
        {section === "other-devices" ? <ControlledDevicesPanel /> : null}
        {section === "ssh" ? (sshOwner ? <SshPanel owner={sshOwner} /> : null) : null}
      </div>
    </div>
  );
}

/**
 * The 「控制其他设备」 half.
 *
 * The Desktop's card, with its own command left disabled: this runtime is a host, it cannot
 * drive another machine, and a button that cannot work must not look like one that can.
 */
function ControlledDevicesPanel(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 pt-3">
        <section>
          <div className="flex flex-col">
            <div className="flex flex-col rounded-2xl bg-bg_grouped_tertiary p-1">
              <div
                className="flex w-full items-center gap-3 rounded-xl p-3"
                data-testid="connection-controlled-devices"
                aria-disabled="true"
              >
                <WebuiInline gap="small" className="min-w-0 flex-1 items-center">
                  <IconDeviceDesktop
                    aria-hidden="true"
                    size={20}
                    stroke={1.7}
                    className="shrink-0 text-icon_default_primary"
                  />
                  <WebuiStack gap="micro" className="min-w-0 flex-1">
                    <span className="text-sm font-medium leading-5 text-text_default_primary">
                      {WEBUI_CONNECTION_CONTROLLED_DEVICES_TITLE}
                    </span>
                    <span className="text-sm leading-5 text-text_default_secondary">
                      {WEBUI_CONNECTION_CONTROLLED_DEVICES_EMPTY}
                    </span>
                  </WebuiStack>
                </WebuiInline>
                <WebuiButton
                  variant="secondary"
                  size="regular"
                  className="h-9 min-w-20 shrink-0 px-3 py-0 font-medium"
                  data-testid="connection-controlled-devices-add"
                  disabled
                  aria-disabled="true"
                  title={WEBUI_CONNECTION_CONTROLLED_DEVICES_UNAVAILABLE}
                >
                  添加
                </WebuiButton>
              </div>
              <p className="px-3 pb-2 text-xs text-text_default_tertiary">
                {WEBUI_CONNECTION_CONTROLLED_DEVICES_UNAVAILABLE}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
