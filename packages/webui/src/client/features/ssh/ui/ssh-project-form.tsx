// The project form: a remote folder, and the browser that picks it.
//
// The folder is picked on the remote machine, one directory at a time: the runtime lists one
// remote directory and the browser walks up and down through them. Nothing is mounted and nothing
// is copied — the project is a path on the far side.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { IconChevronDown, IconChevronUp, IconFile, IconFolder } from "@tabler/icons-react";

import type { WebuiSshConnection, WebuiSshProjectRequest } from "../../../../shared/contracts/ssh.js";
import type { WebuiSshDirectoryListing } from "../application/ssh-owner.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { WebuiButton, WebuiIconButton } from "../../../ui/button.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { WebuiField, WebuiSelectMenu, WebuiTextInput, useWebuiFormValidation } from "../../../ui/field.js";
import { WebuiInline, WebuiStack } from "../../../ui/layout-primitives.js";

export interface SshProjectFormProps {
  readonly hosts: readonly WebuiSshConnection[];
  /** The host the person asked a project for. */
  readonly alias?: string;
  /** Whether the dialog is on screen; the caller owns the exit, so it can finish. */
  readonly open: boolean;
  readonly onExitComplete: () => void;
  readonly onSubmit: (request: WebuiSshProjectRequest) => void;
  readonly onCancel: () => void;
  /** Lists one remote directory. */
  readonly onBrowse: (alias: string, path?: string) => Promise<WebuiSshDirectoryListing>;
  readonly error?: string;
}

export function SshProjectForm(props: SshProjectFormProps): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const requestId = useRef(0);
  // The host the person asked for comes first: the form opens on the row they pressed, and a
  // project that lands on another host is a project on the wrong machine.
  const [alias, setAlias] = useState(props.alias ?? props.hosts[0]?.alias ?? "");
  const [path, setPath] = useState("/");
  const [displayName, setDisplayName] = useState("");
  const [listing, setListing] = useState<WebuiSshDirectoryListing | undefined>(undefined);
  const [browsing, setBrowsing] = useState(false);
  const { errors, validateRequired, clearFieldError } = useWebuiFormValidation();
  const requestedAlias = props.alias;

  // The host can change while the form is open — another row's 新建远程项目 was pressed.
  useEffect(() => {
    if (requestedAlias) setAlias(requestedAlias);
  }, [requestedAlias]);

  const browse = useCallback(async (target: string): Promise<void> => {
    if (!alias) return;
    const currentRequest = ++requestId.current;
    setBrowsing(true);
    try {
      const answer = await props.onBrowse(alias, target);
      if (requestId.current !== currentRequest) return;
      if (answer.ok) {
        setListing(answer);
        setPath(answer.path);
      } else {
        setListing({ ok: false, message: answer.message });
      }
    } finally {
      if (requestId.current === currentRequest) setBrowsing(false);
    }
  }, [alias, props.onBrowse]);

  // The picker opens with the host's root directory visible.
  useEffect(() => {
    setPath("/");
    setListing(undefined);
    void browse("/");
    return () => {
      requestId.current += 1;
    };
  }, [browse]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!validateRequired([{ name: "alias", label: "远程主机", value: alias }])) return;
    props.onSubmit({ alias, path, ...(displayName.trim() === "" ? {} : { displayName: displayName.trim() }) });
  };

  return (
    <WebuiDialog
      id="ssh-create-project-dialog"
      open={props.open}
      onExitComplete={props.onExitComplete}
      title="新建远程项目"
      onClose={props.onCancel}
      dismissOnEscape
      width="wide"
      portalTarget={portalTarget}
      bodyClassName="overflow-y-hidden"
      testId="ssh-create-project-dialog"
      closeTestId="ssh-create-project-close"
      initialFocusRef={nameRef}
      footer={(
        <>
          <WebuiButton variant="secondary" size="dialog" data-webui-ssh-project-cancel="true" onClick={props.onCancel}>
            取消
          </WebuiButton>
          <WebuiButton variant="primary" size="dialog" type="submit" form="ssh-project-form" data-webui-ssh-project-submit="true">
            添加项目
          </WebuiButton>
        </>
      )}
    >
      <form
        id="ssh-project-form"
        aria-label="新建远程项目"
        data-webui-component="ssh-project-form"
        data-webui-ssh-project-form="true"
        className="flex flex-col gap-4"
        onSubmit={submit}
      >
        <WebuiTextInput
          ref={nameRef}
          type="text"
          aria-label="项目名称"
          data-webui-ssh-project-name="true"
          value={displayName}
          placeholder="项目名称"
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <WebuiField
          label="远程主机"
          required
          error={errors.alias}
          gap="small"
          control={(controlProps, field) => (
            <WebuiSelectMenu
              {...controlProps}
              data-webui-ssh-project-host="true"
              labelId={field.labelId}
              options={props.hosts.map((host) => ({
                value: host.alias,
                label: `${host.displayName || host.alias} · ${host.endpoint.host || host.alias}`,
              }))}
              value={alias}
              onChange={(value) => { setAlias(value); clearFieldError("alias"); }}
            />
          )}
        />
        <WebuiField
          label="源文件夹"
          gap="small"
          control={(controlProps) => (
            <WebuiInline gap="small" className="w-full">
              <WebuiTextInput
                {...controlProps}
                type="text"
                data-webui-ssh-project-path="true"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                className="min-w-0 flex-1"
              />
              <WebuiIconButton
                label={listing ? "收起文件夹列表" : "展开文件夹列表"}
                tone="bare"
                size="compact"
                aria-expanded={listing !== undefined}
                data-webui-ssh-project-browse="true"
                disabled={browsing || !alias}
                onClick={() => {
                  if (listing) setListing(undefined);
                  else void browse(path);
                }}
              >
                {listing ? <IconChevronUp size={18} stroke={1.7} /> : <IconChevronDown size={18} stroke={1.7} />}
              </WebuiIconButton>
            </WebuiInline>
          )}
        />
        {listing
          ? listing.ok
            ? (
              <section data-webui-ssh-project-listing="true" aria-label="远程文件夹" className="rounded-xl border border-border_default">
                {listing.entries.length === 0
                  ? <p className="px-4 py-3 text-sm text-text_default_tertiary">这个目录里没有条目。</p>
                  : <WebuiStack as="ul" gap="none" className="scrollbar-hide max-h-[284px] overflow-y-auto p-2">
                    {listing.entries.map((entry) => (
                      <li key={entry.path}>
                        <WebuiButton
                          variant="selectable-row"
                          size="row"
                          data-webui-ssh-project-entry={entry.path}
                          disabled={browsing}
                          onClick={() => {
                            if (entry.kind === "directory") void browse(entry.path);
                            else setPath(entry.path);
                          }}
                          className="h-10 w-full justify-start rounded-lg px-2 text-left"
                        >
                          <WebuiInline gap="small" className="min-w-0 w-full">
                            {entry.kind === "directory"
                              ? <IconFolder aria-hidden="true" size={20} stroke={1.6} className="shrink-0 text-icon_default_secondary" />
                              : <IconFile aria-hidden="true" size={20} stroke={1.6} className="shrink-0 text-icon_default_secondary" />}
                            <span className="min-w-0 truncate">{entry.name}</span>
                          </WebuiInline>
                        </WebuiButton>
                      </li>
                    ))}
                  </WebuiStack>}
              </section>
            )
            : <p data-webui-ssh-project-listing-error="true" className="text-sm text-text_default_secondary">
              {listing.message}
            </p>
          : null}
        {props.error
          ? <p data-webui-ssh-project-error="true" className="text-sm text-text_default_secondary">
            {props.error}
          </p>
          : null}
      </form>
    </WebuiDialog>
  );
}
