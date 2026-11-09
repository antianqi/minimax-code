// One saved SSH host, as the row draws it.
//
// The row is a switch, the host's name with a status dot, the status line under it, and
// two icon actions: a remote project and the row's own menu. The menu carries the commands that
// belong to a host — 设置, 登录, 删除.
//
// 登录 is disabled because the SSH service does not offer remote-account authorization.
//
// 打开终端 opens a remote terminal inside connection settings.
import { useState, type ReactElement } from "react";
import { IconDots, IconFolderPlus, IconLogin, IconSettings, IconTerminal2, IconTrash } from "@tabler/icons-react";

import type { WebuiSshHostRow } from "../projection/ssh-panel.js";
import {
  WEBUI_SSH_LOGIN_UNAVAILABLE,
  WEBUI_SSH_MENU_DELETE,
  WEBUI_SSH_MENU_LOGIN,
  WEBUI_SSH_MENU_SETTINGS,
  WEBUI_SSH_MORE,
  WEBUI_SSH_NEW_REMOTE_PROJECT,
  WEBUI_SSH_OPEN_TERMINAL,
  webuiSshStatusDotClass,
  webuiSshToggleLabel,
  webuiSshViewDetailsLabel,
} from "../projection/ssh-panel.js";
import { WebuiIconButton } from "../../../ui/button.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
import { WebuiMenuItem } from "../../../ui/menu-item.js";
import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";

export interface SshConnectionRowProps {
  readonly row: WebuiSshHostRow;
  /** Whether a row above already drew the list's first line. */
  readonly separated: boolean;
  /** A command is running for this host. */
  readonly busy: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onOpenDetails: () => void;
  readonly onCreateProject: () => void;
  readonly onEdit: () => void;
  readonly onOpenTerminal: () => void;
  readonly onDelete: () => void;
}

export function SshConnectionRow(props: SshConnectionRowProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const row = props.row;
  const dotClass = webuiSshStatusDotClass(row.status, row.enabled);

  return (
    <div
      className={`flex min-h-[72px] items-center gap-3 px-4 py-3${props.separated ? " border-t border-border_light" : ""}`}
      data-testid={`ssh-connection-${row.alias}`}
    >
      <ToggleSwitch
        checked={row.enabled}
        label={webuiSshToggleLabel(row.alias)}
        disabled={props.busy}
        testId={`ssh-connection-toggle-${row.alias}`}
        data-webui-ssh-toggle={row.alias}
        onChange={(checked) => props.onToggle(checked)}
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="flex max-w-full items-center gap-2 text-left"
          aria-label={webuiSshViewDetailsLabel(row.displayName)}
          data-webui-ssh-details={row.alias}
          onClick={props.onOpenDetails}
        >
          <span className="truncate text-[13px] font-medium leading-5 text-text_default_primary">
            {row.displayName}
          </span>
          <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />
          {row.alias === row.displayName
            ? null
            : <span className="truncate text-xs text-text_default_tertiary">{row.alias}</span>}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-text_default_secondary">
          <span data-webui-ssh-status={row.alias}>{row.statusLabel}</span>
          {row.errorLabel === undefined
            ? null
            : <span className="text-text_status_error">{row.errorLabel}</span>}
        </div>
      </div>
      <WebuiIconButton
        label={WEBUI_SSH_NEW_REMOTE_PROJECT}
        title={WEBUI_SSH_NEW_REMOTE_PROJECT}
        tone="bare"
        size="compact"
        className="shrink-0 text-icon_default_secondary"
        data-webui-ssh-new-project={row.alias}
        onClick={props.onCreateProject}
      >
        <IconFolderPlus aria-hidden="true" size={18} stroke={1.7} />
      </WebuiIconButton>
      <WebuiDropdown
        managed
        managedLayerId={`ssh-connection-menu-${row.alias}`}
        open={menuOpen}
        onOpen={() => setMenuOpen(true)}
        onClose={() => setMenuOpen(false)}
        role="menu"
        ariaLabel={`${row.displayName} 的更多操作`}
        align="end"
        collision="flip"
        trigger={(triggerProps) => {
          const { ref, ...rest } = triggerProps;
          return (
            <WebuiIconButton
              label={WEBUI_SSH_MORE}
              tone="bare"
              size="compact"
              className="shrink-0 text-icon_default_secondary"
              data-webui-ssh-more={row.alias}
              {...rest}
              ref={ref}
            >
              <IconDots aria-hidden="true" size={18} stroke={1.7} />
            </WebuiIconButton>
          );
        }}
      >
        <WebuiMenuItem
          icon={<IconSettings aria-hidden="true" size={18} stroke={1.7} />}
          data-webui-ssh-edit={row.alias}
          onClick={() => {
            // The menu steps aside for the thing it opened: a menu left up over the editor
            // covers it, and the next press on this row would only close the menu again.
            setMenuOpen(false);
            props.onEdit();
          }}
        >
          {WEBUI_SSH_MENU_SETTINGS}
        </WebuiMenuItem>
        <WebuiMenuItem
          icon={<IconLogin aria-hidden="true" size={18} stroke={1.7} />}
          disabled
          title={WEBUI_SSH_LOGIN_UNAVAILABLE}
          data-webui-ssh-login={row.alias}
        >
          {WEBUI_SSH_MENU_LOGIN}
        </WebuiMenuItem>
        <WebuiMenuItem
          icon={<IconTerminal2 aria-hidden="true" size={18} stroke={1.7} />}
          data-webui-ssh-terminal={row.alias}
          onClick={() => {
            setMenuOpen(false);
            props.onOpenTerminal();
          }}
        >
          {WEBUI_SSH_OPEN_TERMINAL}
        </WebuiMenuItem>
        <WebuiMenuItem
          icon={<IconTrash aria-hidden="true" size={18} stroke={1.7} />}
          danger
          data-webui-ssh-remove={row.alias}
          onClick={() => {
            setMenuOpen(false);
            props.onDelete();
          }}
        >
          {WEBUI_SSH_MENU_DELETE}
        </WebuiMenuItem>
      </WebuiDropdown>
    </div>
  );
}
