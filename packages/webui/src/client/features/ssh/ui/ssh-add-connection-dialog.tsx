// The 「添加 SSH 连接」 dialog.
//
// Asking to add a host does not open a form: it opens a picker. The
// dialog lists the hosts it found in `~/.ssh/config`, lets one of them be chosen, and keeps
// 「手动添加」 in the footer for the host that is not in the config file. Both paths end in the same
// saved connection, so the picker is where the choice is made and the form is what the manual
// path fills in.
import type { ReactElement, ReactNode } from "react";
import { IconRefresh } from "@tabler/icons-react";

import type { WebuiSshDiscovery } from "../../../../shared/contracts/ssh.js";
import {
  WEBUI_SSH_ADD,
  WEBUI_SSH_ADD_CONNECTION_TITLE,
  WEBUI_SSH_MANUAL_ADD,
} from "../projection/ssh-panel.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { WebuiInline } from "../../../ui/layout-primitives.js";
import { useWebuiToastError } from "../../../ui/toast.js";
import { SshConnectionPicker } from "./ssh-connection-picker.js";

export interface SshAddConnectionDialogProps {
  readonly open: boolean;
  /** The dialog's title: the picker and the editor are named differently. */
  readonly title?: string;
  /** The hosts found in `~/.ssh/config`, when the read has answered. */
  readonly discovery?: WebuiSshDiscovery;
  /** The read is running. */
  readonly loading: boolean;
  /** The host the person picked. */
  readonly selected?: string;
  /** The manual form, shown instead of the picker. */
  readonly manual: boolean;
  readonly manualForm?: ReactNode;
  readonly error?: string;
  readonly onSelect: (alias: string) => void;
  readonly onManual: () => void;
  readonly onConfirm: () => void;
  readonly onRefresh: () => void;
  readonly onClose: () => void;
}

export function SshAddConnectionDialog(props: SshAddConnectionDialogProps): ReactElement | null {
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();
  const hosts = props.discovery?.hosts ?? [];
  const empty = !props.loading && hosts.length === 0;
  // The failed attempt is said once; the dialog keeps the controls that can
  // still answer it.
  useWebuiToastError(props.error, {
    testId: "ssh-add-connection-error",
    dataAttributes: { "data-webui-ssh-add-error": "true" },
  });

  return (
    <WebuiDialog
      id="ssh-add-connection-dialog"
      open={props.open}
      title={props.title ?? WEBUI_SSH_ADD_CONNECTION_TITLE}
      onClose={props.onClose}
      dismissOnEscape
      width="standard"
      portalTarget={portalTarget}
      testId="ssh-add-connection-dialog"
      footer={
        <>
          <WebuiButton
            variant="quiet-secondary"
            size="dialog"
            data-webui-ssh-manual-add="true"
            onClick={props.onManual}
          >
            <IconRefresh aria-hidden="true" size={16} stroke={1.7} />
            {WEBUI_SSH_MANUAL_ADD}
          </WebuiButton>
          <WebuiButton
            variant="primary"
            size="dialog"
            data-webui-ssh-confirm-add="true"
            disabled={!props.manual && !props.selected}
            onClick={props.onConfirm}
          >
            {WEBUI_SSH_ADD}
          </WebuiButton>
        </>
      }
    >
      {props.manual
        ? props.manualForm
        : <SshConnectionPicker
          {...(props.discovery ? { discovery: props.discovery } : {})}
          loading={props.loading}
          {...(props.selected === undefined ? {} : { selected: props.selected })}
          onSelect={props.onSelect}
        />}
      {!props.manual
        ? <WebuiInline gap="small" className="mt-3">
            <WebuiButton
              variant="quiet-subtle"
              size="inline-dense"
              data-webui-ssh-refresh-discovery="true"
              onClick={props.onRefresh}
            >
              重新读取
            </WebuiButton>
          </WebuiInline>
        : null}
    </WebuiDialog>
  );
}
