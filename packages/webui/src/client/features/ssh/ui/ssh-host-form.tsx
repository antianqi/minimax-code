// The host form: add a host by hand, or take one from `~/.ssh/config`.
//
// The two kinds are the runtime's own: `manual` is a host, a port, a user and a key typed in;
// `ssh_config` is an alias from the config file, which the runtime resolves through OpenSSH.
//
// The password field is a one-shot: it is handed to the host for the first handshake and is not
// kept in the browser.
import { useEffect, useState, type ReactElement } from "react";

import type { WebuiSshSaveConnectionRequest } from "../../../../shared/contracts/ssh.js";
import {
  webuiSshOverridePort,
  webuiSshOverrideValue,
  webuiSshPortInputError,
  type WebuiSshEndpointValues,
} from "../projection/ssh-panel.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiField, WebuiRadio, WebuiTextInput, useWebuiFormValidation } from "../../../ui/field.js";
import { WebuiInline } from "../../../ui/layout-primitives.js";
import { useWebuiToastError } from "../../../ui/toast.js";

export interface SshHostFormProps {
  readonly onSubmit: (request: WebuiSshSaveConnectionRequest) => void;
  readonly onCancel: () => void;
  /**
   * The host being edited, when the form edits one.
   *
   * A saved host's alias is its name: the editor shows the alias as text and does not
   * offer to change it, and a changed alias here would save a second host and leave the first
   * one behind. The values here are the ones the host is reached with, so the form opens on
   * them.
   */
  readonly initial?: {
    readonly alias: string;
    readonly hostname?: string;
    readonly user?: string;
    readonly port?: number;
    readonly identityFile?: string;
  };
  /**
   * The values `~/.ssh/config` resolves for this alias, and the overrides the saved host
   * carries.
   *
   * A field the person leaves alone keeps the override it has; a field they set back to the
   * config's own value drops the override and follows the config again. This is the rule
   * for a host named in `~/.ssh/config`.
   */
  readonly override?: {
    readonly config?: WebuiSshEndpointValues;
    readonly saved?: WebuiSshEndpointValues;
  };
  readonly error?: string;
  readonly busy?: boolean;
}

export function SshHostForm(props: SshHostFormProps): ReactElement {
  const initial = props.initial;
  const [kind, setKind] = useState<"manual" | "ssh_config">(initial ? "ssh_config" : "manual");
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [displayName, setDisplayName] = useState("");
  const [host, setHost] = useState(initial?.hostname ?? "");
  const [port, setPort] = useState(initial?.port ? String(initial.port) : "");
  const [username, setUsername] = useState(initial?.user ?? "");
  const [identityFile, setIdentityFile] = useState(initial?.identityFile ?? "");
  const [password, setPassword] = useState("");
  /** What the form itself refuses, next to what the runtime answered. */
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const { errors, validateRequired, setFieldError, clearFieldError, clearErrors } = useWebuiFormValidation();
  // The failure is said once: what the form refuses and what the runtime
  // answered are one answer, and it does not belong in the form's layout.
  useWebuiToastError(formError ?? props.error, {
    dataAttributes: { "data-webui-ssh-form-error": "true" },
  });

  // The editor opens before the config file has been read, so the values it shows arrive
  // afterwards. The fields follow them.
  const initialSignature = JSON.stringify(props.initial ?? null);
  const editing = props.initial !== undefined;
  useEffect(() => {
    const value = (JSON.parse(initialSignature) ?? {}) as {
      readonly alias?: string;
      readonly hostname?: string;
      readonly user?: string;
      readonly port?: number;
      readonly identityFile?: string;
    };
    setAlias(value.alias ?? "");
    setHost(value.hostname ?? "");
    setPort(value.port === undefined ? "" : String(value.port));
    setUsername(value.user ?? "");
    setIdentityFile(value.identityFile ?? "");
  }, [initialSignature]);

  const submit = (): void => {
    setFormError(undefined);
    clearErrors();
    if (!validateRequired([
      { name: "alias", label: "别名", value: alias },
      { name: "host", label: "主机", value: host, required: kind === "manual" },
    ])) return;
    const portProblem = webuiSshPortInputError(port);
    if (portProblem) {
      // A port that cannot be read is refused here: the runtime would drop it, and the
      // connection would land on a different port than the one that was named.
      setFieldError("port", portProblem);
      return;
    }
    const aliasValue = alias.trim();
    const hostValue = host.trim();
    const userValue = username.trim();
    const identityValue = identityFile.trim();
    const portText = port.trim();
    const portNumber = portText === "" ? undefined : Number.parseInt(portText, 10);
    // A host named in `~/.ssh/config` follows the config file unless a value is overridden on
    // purpose; a host typed in by hand carries everything it needs.
    const config = kind === "ssh_config" ? props.override?.config : undefined;
    const saved = kind === "ssh_config" ? props.override?.saved : undefined;
    const hostOverride = webuiSshOverrideValue(hostValue, saved?.hostname, config?.hostname);
    const userOverride = webuiSshOverrideValue(userValue, saved?.user, config?.user);
    const identityOverride = webuiSshOverrideValue(
      identityValue,
      saved?.identityFile,
      config?.identityFile,
    );
    const portOverride = webuiSshOverridePort(portText, saved?.port, config?.port);
    const request: WebuiSshSaveConnectionRequest = {
      alias: aliasValue,
      ...(displayName.trim() === "" ? {} : { displayName: displayName.trim() }),
      endpoint:
        kind === "ssh_config"
          ? {
              kind: "ssh_config",
              alias: aliasValue,
              ...(hostOverride === undefined ? {} : { host: hostOverride }),
              ...(portOverride === undefined ? {} : { port: portOverride }),
              ...(userOverride === undefined ? {} : { username: userOverride }),
              ...(identityOverride === undefined ? {} : { identityFile: identityOverride }),
            }
          : {
              kind: "manual",
              host: hostValue,
              ...(portNumber === undefined || Number.isNaN(portNumber) ? {} : { port: portNumber }),
              ...(userValue === "" ? {} : { username: userValue }),
              ...(identityValue === "" ? {} : { identityFile: identityValue }),
            },
      ...(password === "" ? {} : { password }),
    };
    props.onSubmit(request);
  };

  return (
    <form
      aria-label="添加 SSH 主机"
      data-webui-component="ssh-host-form"
      className="rounded-[8px] border border-border_default px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <WebuiInline gap="medium">
        <WebuiInline as="label" gap="tight" className="text-xs text-text_default_secondary">
          <WebuiRadio
            name="webui-ssh-kind"
            data-webui-ssh-kind="manual"
            checked={kind === "manual"}
            onChange={() => setKind("manual")}
          />
          手动填写
        </WebuiInline>
        <WebuiInline as="label" gap="tight" className="text-xs text-text_default_secondary">
          <WebuiRadio
            name="webui-ssh-kind"
            data-webui-ssh-kind="ssh_config"
            checked={kind === "ssh_config"}
            onChange={() => setKind("ssh_config")}
          />
          来自 ~/.ssh/config
        </WebuiInline>
      </WebuiInline>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <WebuiField
          className="col-span-2"
          label="别名"
          required
          error={errors.alias}
          control={(controlProps) => (
            <WebuiTextInput
              {...controlProps}
              controlSize="compact"
              type="text"
              data-webui-ssh-field="alias"
              placeholder="例如：production"
              value={alias}
              readOnly={editing}
              onChange={(event) => { setAlias(event.target.value); clearFieldError("alias"); }}
              className="mt-0.5"
            />
          )}
        />
        <WebuiField
          className="col-span-2"
          label="显示名称"
          control={(controlProps) => (
            <WebuiTextInput
              {...controlProps}
              controlSize="compact"
              type="text"
              data-webui-ssh-field="displayName"
              placeholder="例如：生产服务器"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-0.5"
            />
          )}
        />
        <WebuiField
          label="主机"
          required={kind === "manual"}
          error={errors.host}
          control={(controlProps) => (
            <WebuiTextInput
              {...controlProps}
              controlSize="compact"
              type="text"
              data-webui-ssh-field="host"
              placeholder="主机名或 IP 地址"
              value={host}
              onChange={(event) => { setHost(event.target.value); clearFieldError("host"); }}
              className="mt-0.5"
            />
          )}
        />
        <WebuiField
          label="端口"
          error={errors.port}
          control={(controlProps) => (
            <WebuiTextInput
              {...controlProps}
              controlSize="compact"
              type="text"
              data-webui-ssh-field="port"
              placeholder="22"
              value={port}
              onChange={(event) => { setPort(event.target.value); clearFieldError("port"); }}
              className="mt-0.5"
            />
          )}
        />
        <WebuiField
          label="用户名"
          control={(controlProps) => (
            <WebuiTextInput
              {...controlProps}
              controlSize="compact"
              type="text"
              data-webui-ssh-field="username"
              placeholder="登录用户名"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-0.5"
            />
          )}
        />
        <WebuiField
          label="私钥文件"
          control={(controlProps) => (
            <WebuiTextInput
              {...controlProps}
              controlSize="compact"
              type="text"
              data-webui-ssh-field="identityFile"
              placeholder="例如：~/.ssh/id_ed25519"
              value={identityFile}
              onChange={(event) => setIdentityFile(event.target.value)}
              className="mt-0.5"
            />
          )}
        />
        <WebuiField
          className="col-span-2"
          label="密码（仅用于第一次握手，不会保存在浏览器里）"
          control={(controlProps) => (
            <WebuiTextInput
              {...controlProps}
              controlSize="compact"
              type="password"
              data-webui-ssh-field="password"
              placeholder="输入本次连接使用的密码"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-0.5"
            />
          )}
        />
      </div>
      <WebuiInline gap="small" className="mt-2">
        <WebuiButton variant="outline" size="inline-dense" type="submit"
          data-webui-ssh-form-submit="true"
          disabled={props.busy}
        >
          保存
        </WebuiButton>
        <WebuiButton variant="quiet-secondary" size="inline-dense" data-webui-ssh-form-cancel="true"
          onClick={props.onCancel}

        >
          取消
        </WebuiButton>
      </WebuiInline>
    </form>
  );
}
