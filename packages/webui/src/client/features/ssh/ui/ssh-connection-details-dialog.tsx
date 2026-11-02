// The Desktop's 「查看连接详情」 dialog.
//
// The Desktop opens a host's details from the host's name, and the dialog is where the host's
// own facts are shown: what it is called, where it lives, what state it is in. It is read-only
// apart from the two commands the Desktop offers there, and this client offers the same two.
import type { ReactElement } from "react";

import type { WebuiSshConnection } from "../../../../shared/contracts/ssh.js";
import { webuiSshEndpointLabel, webuiSshStatusLabel } from "../projection/ssh-panel.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { WebuiStack } from "../../../ui/layout-primitives.js";

export interface SshConnectionDetailsDialogProps {
  readonly open: boolean;
  readonly connection?: WebuiSshConnection;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}

function Fact({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-20 shrink-0 text-sm text-text_default_secondary">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-text_default_primary">{value}</span>
    </div>
  );
}

export function SshConnectionDetailsDialog(props: SshConnectionDetailsDialogProps): ReactElement | null {
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();
  const connection = props.connection;
  if (!connection) return null;

  return (
    <WebuiDialog
      id="ssh-connection-details-dialog"
      open={props.open}
      title={`${connection.displayName} 的连接详情`}
      onClose={props.onClose}
      dismissOnEscape
      width="standard"
      portalTarget={portalTarget}
      testId="ssh-connection-details-dialog"
      footer={
        <>
          <WebuiButton variant="danger-soft" size="dialog" data-webui-ssh-details-delete="true" onClick={props.onDelete}>
            删除
          </WebuiButton>
          <WebuiButton variant="primary" size="dialog" data-webui-ssh-details-edit="true" onClick={props.onEdit}>
            设置
          </WebuiButton>
        </>
      }
    >
      <WebuiStack gap="micro" data-webui-ssh-details-body="true">
        <Fact label="别名" value={connection.alias} />
        <Fact label="地址" value={webuiSshEndpointLabel(connection.endpoint)} />
        <Fact label="状态" value={webuiSshStatusLabel(connection.status)} />
        <Fact label="启用" value={connection.enabled ? "是" : "否"} />
        {connection.lastError === undefined
          ? null
          : <Fact label="最近错误" value={connection.lastError} />}
      </WebuiStack>
    </WebuiDialog>
  );
}
