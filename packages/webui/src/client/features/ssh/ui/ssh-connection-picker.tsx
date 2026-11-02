// The hosts the picker offers.
//
// The Desktop's add dialog is a picker before it is a form: it lists the hosts it found in
// `~/.ssh/config` and lets one of them be chosen. This module is that list, without the dialog
// around it, so what it says can be tested on its own.
import type { ReactElement } from "react";
import { IconTerminal2 } from "@tabler/icons-react";

import type { WebuiSshDiscoveredHost, WebuiSshDiscovery } from "../../../../shared/contracts/ssh.js";
import {
  WEBUI_SSH_DISCOVERING,
  WEBUI_SSH_NO_CANDIDATES,
  webuiSshDiscoveredHostLabel,
} from "../projection/ssh-panel.js";
import { WebuiRadio } from "../../../ui/field.js";
import { WebuiStack } from "../../../ui/layout-primitives.js";

export interface SshConnectionPickerProps {
  readonly discovery?: WebuiSshDiscovery;
  /** The read is running. */
  readonly loading: boolean;
  /** The host the person picked. */
  readonly selected?: string;
  readonly onSelect: (alias: string) => void;
}

export function SshConnectionPicker(props: SshConnectionPickerProps): ReactElement {
  const hosts = props.discovery?.hosts ?? [];
  return (
    <WebuiStack gap="small" data-webui-ssh-picker="true">
      {props.loading
        ? <p data-webui-ssh-discovering="true" className="text-[13px] text-text_default_secondary">
          {WEBUI_SSH_DISCOVERING}
        </p>
        : null}
      {!props.loading && hosts.length === 0
        ? <p data-webui-ssh-no-candidates="true" className="text-[13px] text-text_default_secondary">
          {WEBUI_SSH_NO_CANDIDATES}
        </p>
        : null}
      {hosts.map((host: WebuiSshDiscoveredHost) => (
        <label
          key={host.alias}
          data-webui-ssh-candidate={host.alias}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border_default px-3 py-2"
        >
          <IconTerminal2
            aria-hidden="true"
            size={18}
            stroke={1.7}
            className="shrink-0 text-icon_default_primary"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-5 text-text_default_primary">
              {host.alias}
            </span>
            <span className="block truncate text-xs text-text_default_secondary">
              {webuiSshDiscoveredHostLabel(host)}
            </span>
          </span>
          <WebuiRadio
            name="webui-ssh-candidate"
            checked={props.selected === host.alias}
            onChange={() => props.onSelect(host.alias)}
            aria-label={host.alias}
          />
        </label>
      ))}
    </WebuiStack>
  );
}
