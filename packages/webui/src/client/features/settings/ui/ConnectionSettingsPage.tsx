// The connection page offers this-device remote control and SSH connections. Each body comes
// from the business that owns it: remote control for this device and SSH for remote hosts.
import { useState, type ReactElement } from "react";

import { RemoteControlDevices } from "../../remote-control/ui/RemoteControlDevices.public.js";
import { SshPanel } from "../../ssh/ui/SshPanel.public.js";
import { useWebuiSshOwner } from "../../../bindings/ssh-owner-context.js";
import { WebuiButton } from "../../../ui/button.js";
import { SettingsPage } from "../../../ui/settings-layout.js";

export type WebuiConnectionSection = "this-device" | "ssh";

/** The supported connection settings tabs. */
export const WEBUI_CONNECTION_SECTIONS: readonly {
  readonly value: WebuiConnectionSection;
  readonly label: string;
}[] = [
  { value: "this-device", label: "控制这台电脑" },
  { value: "ssh", label: "SSH" },
];

export interface ConnectionSettingsPageProps {
  /** The tab the page opens on. */
  readonly initialSection?: WebuiConnectionSection;
}

export function ConnectionSettingsPage(props: ConnectionSettingsPageProps): ReactElement {
  const [section, setSection] = useState<WebuiConnectionSection>(props.initialSection ?? "this-device");
  const sshOwner = useWebuiSshOwner();

  return (
    <SettingsPage testId="connection-settings">
      <div className="flex w-full flex-col gap-3">
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
          {section === "ssh" ? (sshOwner ? <SshPanel owner={sshOwner} /> : null) : null}
        </div>
      </div>
    </SettingsPage>
  );
}
