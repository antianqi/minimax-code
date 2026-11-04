// The published surface of the SSH business.
//
// The shell is a peer of this business and may only import what the business publishes, and a
// published module may not re-export another module's symbol — so the panel lives here and is
// published as itself rather than through a forwarding file.
//
// Split in two on purpose. `SshPanelView` is a pure render of a snapshot, so a test can pin every
// branch — the host rows, the empty state, the project rows, the terminal — through
// `renderToStaticMarkup` without a DOM (there is no jsdom in this package). `SshPanel` is the thin
// part that subscribes to the owner and reads once when it opens.
//
// The panel is a surface of its own: it does not assume which page hosts it. The settings page's
// `连接` tab mounts this one component, and the 远程 page's own entry opens that tab rather than
// carrying a second copy of the host list.
//
// The shape is the `设置 > 连接 > SSH` half: the hosts in one grouped card, a switch
// and the host's own menu on each row, and one 「添加」 button that opens the host picker.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { IconLoader2, IconTerminal2 } from "@tabler/icons-react";

import type {
  WebuiSshConnection,
  WebuiSshDiscoveredHost,
  WebuiSshDiscovery,
  WebuiSshProject,
} from "../../../../shared/contracts/ssh.js";
import type {
  WebuiSshSnapshot,
  WebuiSshTerminalSnapshot,
} from "../application/ssh-owner.js";
import type { createWebuiSshOwner } from "../application/ssh-owner.js";
import {
  webuiSshHostRows,
  webuiSshProjectRows,
  WEBUI_SSH_ADD,
  WEBUI_SSH_ADD_CONNECTION_TITLE,
  WEBUI_SSH_EMPTY_DESCRIPTION,
  WEBUI_SSH_EMPTY_TITLE,
  WEBUI_SSH_EDIT_CONNECTION_TITLE,
  WEBUI_SSH_LOADING_TEXT,
} from "../projection/ssh-panel.js";
import { SshAddConnectionDialog } from "./ssh-add-connection-dialog.js";
import { SshConnectionDetailsDialog } from "./ssh-connection-details-dialog.js";
import { SshConnectionRow } from "./ssh-connection-row.js";
import { SshHostForm } from "./ssh-host-form.js";
import { SshProjectForm } from "./ssh-project-form.js";
import { SshTerminalView } from "./ssh-terminal-view.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { WebuiStack } from "../../../ui/layout-primitives.js";
import { useWebuiToastError, useWebuiToastSuccess } from "../../../ui/toast.js";

export interface SshPanelViewProps {
  readonly snapshot: WebuiSshSnapshot;
  /** The terminal window's snapshot: the live one, or the last one while it closes. */
  readonly terminal: WebuiSshTerminalSnapshot;
  /** Whether the terminal window is on screen. */
  readonly terminalOpen: boolean;
  /** Whether the terminal window has finished its exit motion. */
  readonly terminalExited: boolean;
  /**
   * The closing window stays mounted until the shared motion reports it finished,
   * so the exit can play instead of the window disappearing in one frame.
   */
  readonly onTerminalExitComplete: () => void;
  /** The project form, rendered as a managed dialog by the panel. */
  readonly projectDialog?: ReactNode;
  /** The add dialog, rendered by the panel because it needs the overlay layer. */
  readonly addDialog?: ReactNode;
  /** The details dialog. */
  readonly detailsDialog?: ReactNode;
  /** The removal confirmation. */
  readonly removeDialog?: ReactNode;
  /** A message from the last action. */
  readonly notice?: string;
  /** The reason the last action failed. */
  readonly error?: string;
  readonly onOpenAdd: () => void;
  readonly onToggleHost: (connection: WebuiSshConnection) => void;
  readonly onOpenDetails: (connection: WebuiSshConnection) => void;
  readonly onCreateProject: (connection: WebuiSshConnection) => void;
  readonly onEditHost: (connection: WebuiSshConnection) => void;
  readonly onOpenTerminal: (connection: WebuiSshConnection) => void;
  readonly onCloseTerminal: () => void;
  readonly onTerminalInput: (data: string) => void;
  readonly onTerminalResize: (cols: number, rows: number) => void;
  readonly onRemoveProject: (project: WebuiSshProject) => void;
  readonly onRequestRemove: (connection: WebuiSshConnection) => void;
}

export function SshPanelView(props: SshPanelViewProps): ReactElement {
  const hostRows = webuiSshHostRows(props.snapshot.connections);
  const projectRows = webuiSshProjectRows(props.snapshot.projects);
  const loading = props.snapshot.status === "loading" && hostRows.length === 0;
  // "No host at all" is only true of a successful read: a failed one is not empty, and saying so
  // would invite the person to add a host they may already have.
  const showEmpty = hostRows.length === 0 && props.snapshot.status === "ready";
  // The two failures and the one confirmation are said once each: they took
  // room from the panel and stayed there long after the moment had passed.
  useWebuiToastError(props.snapshot.error, {
    testId: "ssh-connection-error",
    dataAttributes: { "data-webui-ssh-error": "true" },
  });
  useWebuiToastError(props.error, {
    testId: "ssh-action-error",
    dataAttributes: { "data-webui-ssh-action-error": "true" },
  });
  useWebuiToastSuccess(props.notice, {
    dataAttributes: { "data-webui-ssh-notice": "true" },
  });

  return (
    <div
      className="flex w-full flex-col gap-3"
      data-testid="ssh-connections-section"
      data-webui-component="ssh-panel"
    >
      {loading
        ? <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-text_default_secondary">
          <IconLoader2 aria-hidden="true" size={16} stroke={1.7} />
          {WEBUI_SSH_LOADING_TEXT}
        </div>
        : null}
      {showEmpty
        ? <div
          className="flex w-full items-center gap-3 rounded-2xl bg-bg_grouped_tertiary p-4"
          data-webui-ssh-empty="true"
        >
          <IconTerminal2 aria-hidden="true" size={20} stroke={1.7} className="shrink-0 text-icon_default_primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-5 text-text_default_primary">
              {WEBUI_SSH_EMPTY_TITLE}
            </p>
            <p className="text-[13px] leading-5 text-text_default_secondary">
              {WEBUI_SSH_EMPTY_DESCRIPTION}
            </p>
          </div>
          <WebuiButton
            variant="primary"
            size="header"
            className="h-[30px] min-w-[52px] shrink-0 px-3 py-0 font-medium"
            data-webui-ssh-add="true"
            onClick={props.onOpenAdd}
          >
            {WEBUI_SSH_ADD}
          </WebuiButton>
        </div>
        : null}
      {hostRows.length === 0
        ? null
        : <div className="flex flex-col overflow-hidden rounded-2xl bg-bg_grouped_tertiary" data-webui-ssh-list="true">
          {hostRows.map((row, index) => {
            const connection = props.snapshot.connections.find((item) => item.alias === row.alias);
            if (!connection) return null;
            return (
              <SshConnectionRow
                key={row.alias}
                row={row}
                separated={index > 0}
                busy={false}
                onToggle={(enabled) => props.onToggleHost(connection)}
                onOpenDetails={() => props.onOpenDetails(connection)}
                onCreateProject={() => props.onCreateProject(connection)}
                onEdit={() => props.onEditHost(connection)}
                onOpenTerminal={() => props.onOpenTerminal(connection)}
                onDelete={() => props.onRequestRemove(connection)}
              />
            );
          })}
        </div>}
      {hostRows.length > 0 && !loading
        ? <div className="flex justify-end">
          <WebuiButton
            variant="secondary"
            size="header"
            className="inline-flex h-[30px] items-center justify-center px-3 py-0 text-center font-medium"
            data-webui-ssh-add="true"
            onClick={props.onOpenAdd}
          >
            {WEBUI_SSH_ADD}
          </WebuiButton>
        </div>
        : null}
      {projectRows.length === 0
        ? null
        : <WebuiStack as="ul" gap="small" data-webui-ssh-projects="true">
          {projectRows.map((row) => (
            <li
              key={row.id}
              data-webui-ssh-project={row.id}
              className="flex items-center gap-3 rounded-xl bg-bg_grouped_tertiary px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-5 text-text_default_primary">
                  {row.displayName}
                </span>
                <span className="block truncate text-xs text-text_default_secondary">
                  {row.alias} · {row.path}
                </span>
              </span>
              <WebuiButton
                variant="outline-secondary"
                size="inline-tiny"
                data-webui-ssh-project-remove={row.id}
                onClick={() => {
                  const project = props.snapshot.projects.find((item) => item.id === row.id);
                  if (project) props.onRemoveProject(project);
                }}
              >
                删除
              </WebuiButton>
            </li>
          ))}
        </WebuiStack>}
      {props.terminalOpen || !props.terminalExited
        ? <SshTerminalView
          terminal={props.terminal}
          open={props.terminalOpen}
          onExitComplete={props.onTerminalExitComplete}
          onInput={props.onTerminalInput}
          onResize={props.onTerminalResize}
          onClose={props.onCloseTerminal}
        />
        : null}
      {props.addDialog}
      {props.projectDialog}
      {props.detailsDialog}
      {props.removeDialog}
    </div>
  );
}

/**
 * The published panel.
 *
 * The owner is the only thing it needs: the panel reads the snapshot, subscribes to the owner's
 * changes and turns the person's clicks into the owner's calls. Which page hosts it is not the
 * panel's business.
 */
export interface SshPanelProps {
  readonly owner: ReturnType<typeof createWebuiSshOwner>;
}

export function SshPanel(props: SshPanelProps): ReactElement {
  const browseDirectories = useCallback(
    (alias: string, path?: string) => props.owner.listDirectories(alias, path),
    [props.owner],
  );
  const snapshot = useSyncExternalStore(
    props.owner.subscribe,
    props.owner.getSnapshot,
    props.owner.getSnapshot,
  );
  const terminal = useSyncExternalStore(
    props.owner.subscribe,
    props.owner.getTerminalSnapshot,
    props.owner.getTerminalSnapshot,
  );
  const [addOpen, setAddOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<WebuiSshConnection | undefined>(undefined);
  const [details, setDetails] = useState<WebuiSshConnection | undefined>(undefined);
  const [removing, setRemoving] = useState<WebuiSshConnection | undefined>(undefined);
  // The project form outlives its `open` flag: the panel keeps it mounted while
  // the shared exit motion plays and drops it when the dialog reports it done.
  const [projectForm, setProjectForm] = useState<{ alias: string; open: boolean } | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void props.owner.load();
  }, [props.owner]);

  const terminalId = terminal.terminalId;
  useEffect(() => props.owner.watchTerminal(), [props.owner, terminalId]);

  // A closing terminal keeps the snapshot it was running with, so the exit motion
  // replays the window being left rather than an emptied frame; the view is
  // unmounted once that motion reports finished.
  const terminalOpen = terminal.status !== "closed";
  const retainedTerminal = useRef(terminal);
  if (terminalOpen) retainedTerminal.current = terminal;
  // Starts as "nothing to keep mounted": the panel opens with no terminal, and a
  // view mounted there would announce a connection it was never asked to make.
  const [terminalExited, setTerminalExited] = useState(!terminalOpen);
  useEffect(() => {
    if (terminalOpen) setTerminalExited(false);
  }, [terminalOpen]);

  const openAdd = (): void => {
    setEditing(undefined);
    setManual(false);
    setSelected(undefined);
    setError(undefined);
    setAddOpen(true);
    void props.owner.loadDiscovery();
  };

  const closeAdd = (): void => {
    setAddOpen(false);
    setManual(false);
    setSelected(undefined);
    setEditing(undefined);
  };

  const confirmAdd = (): void => {
    const alias = selected;
    if (!alias) return;
    const host: WebuiSshDiscoveredHost | undefined = snapshot.discovery?.hosts.find((item) => item.alias === alias);
    if (!host) return;
    void props.owner.saveConnection({
      alias: host.alias,
      // Only the alias is stored. OpenSSH reads the host, the user, the port and the key from
      // `~/.ssh/config` when it is asked for that alias, and nothing else is stored for a
      // host picked from the config file. Stashing the values `ssh -G` reported instead would pin the
      // host to the config as it reads today, and a key path that config file spells with a `~`
      // would not survive the runtime's own path check.
      endpoint: {
        kind: "ssh_config",
        alias: host.alias,
      },
    }).then((answer) => {
      if (answer.ok) {
        closeAdd();
        setNotice("远程连接已保存");
        return;
      }
      setError(answer.message);
    });
  };

  const saveManual = (request: Parameters<ReturnType<typeof createWebuiSshOwner>["saveConnection"]>[0]): void => {
    void props.owner.saveConnection(request).then((answer) => {
      if (answer.ok) {
        closeAdd();
        setNotice("远程连接已保存");
        return;
      }
      setError(answer.message);
    });
  };

  const confirmRemove = (): void => {
    const connection = removing;
    if (!connection) return;
    void props.owner.removeConnection(connection.alias).then((answer) => {
      setRemoving(undefined);
      if (!answer.ok) {
        setError(answer.message);
        return;
      }
      setNotice("连接已移除");
    });
  };

  // What `~/.ssh/config` resolves for the host being edited: the value a field falls back
  // to, and the value a field set back to means "follow the config again".
  const discovered = editing
    ? snapshot.discovery?.hosts.find((item) => item.alias === editing.alias)
    : undefined;
  // The values the host is reached with: an override the person made, else the config's.
  const editingHost = editing === undefined ? undefined : editing.endpoint.host ?? discovered?.hostname;
  const editingUser = editing === undefined ? undefined : editing.endpoint.username ?? discovered?.user;
  const editingPort = editing === undefined ? undefined : editing.endpoint.port ?? discovered?.port ?? 22;
  const editingIdentityFile =
    editing === undefined ? undefined : editing.endpoint.identityFile ?? discovered?.identityFile;

  const hostForm = (
    <SshHostForm
      {...(editing
        ? {
            initial: {
              alias: editing.alias,
              ...(editingHost === undefined ? {} : { hostname: editingHost }),
              ...(editingUser === undefined ? {} : { user: editingUser }),
              ...(editingPort === undefined ? {} : { port: editingPort }),
              ...(editingIdentityFile === undefined ? {} : { identityFile: editingIdentityFile }),
            },
            override: {
              config: {
                ...(discovered?.hostname === undefined ? {} : { hostname: discovered.hostname }),
                ...(discovered?.user === undefined ? {} : { user: discovered.user }),
                ...(discovered?.port === undefined ? {} : { port: discovered.port }),
                ...(discovered?.identityFile === undefined ? {} : { identityFile: discovered.identityFile }),
              },
              saved: {
                ...(editing.endpoint.host === undefined ? {} : { hostname: editing.endpoint.host }),
                ...(editing.endpoint.username === undefined ? {} : { user: editing.endpoint.username }),
                ...(editing.endpoint.port === undefined ? {} : { port: editing.endpoint.port }),
                ...(editing.endpoint.identityFile === undefined ? {} : { identityFile: editing.endpoint.identityFile }),
              },
            },
          }
        : {})}
      onCancel={closeAdd}
      error={error}
      onSubmit={saveManual}
    />
  );

  const closeProjectForm = (): void => {
    setProjectForm((current) => (current ? { ...current, open: false } : undefined));
  };

  const projectDialog = projectForm === undefined
    ? undefined
    : <SshProjectForm
      hosts={snapshot.connections}
      alias={projectForm.alias}
      open={projectForm.open}
      onExitComplete={() => setProjectForm(undefined)}
      error={error}
      onBrowse={browseDirectories}
      onCancel={closeProjectForm}
      onSubmit={(request) => {
        void props.owner.saveProject(request).then((answer) => {
          if (answer.ok) {
            closeProjectForm();
            setNotice("已保存项目。");
            return;
          }
          setError(answer.message);
        });
      }}
    />;

  return (
    <SshPanelView
      snapshot={snapshot}
      terminal={terminalOpen ? terminal : retainedTerminal.current}
      terminalOpen={terminalOpen}
      terminalExited={terminalExited}
      onTerminalExitComplete={() => setTerminalExited(true)}
      {...(projectDialog ? { projectDialog } : {})}
      {...(notice === undefined ? {} : { notice })}
      {...(error === undefined ? {} : { error })}
      onOpenAdd={openAdd}
      onToggleHost={(connection) => {
        void props.owner.setEnabled(connection.alias, !connection.enabled).then((answer) => {
          if (!answer.ok) setError(answer.message);
        });
      }}
      onOpenDetails={(connection) => setDetails(connection)}
      onCreateProject={(connection) => setProjectForm({ alias: connection.alias, open: true })}
      onEditHost={(connection) => {
        setEditing(connection);
        setManual(true);
        setError(undefined);
        setAddOpen(true);
        // The editor shows what the config file resolves for this alias, so it reads the
        // config first.
        void props.owner.loadDiscovery();
      }}
      onOpenTerminal={(connection) => {
        void props.owner.openTerminal(connection.alias).then((answer) => {
          if (!answer.ok) setError(answer.message);
        });
      }}
      onCloseTerminal={() => {
        void props.owner.closeTerminal();
      }}
      onTerminalInput={(data) => {
        void props.owner.writeTerminal(data);
      }}
      onTerminalResize={(cols, rows) => {
        void props.owner.resizeTerminal(cols, rows);
      }}
      onRemoveProject={(project) => {
        void props.owner.removeProject(project.id).then((answer) => {
          if (!answer.ok) {
            setError(answer.message);
            return;
          }
          // The panel's last word has to match what it did: a notice that still says the
          // project was saved is a notice about a project that is gone.
          setError(undefined);
          setNotice("项目已移除");
        });
      }}
      onRequestRemove={(connection) => setRemoving(connection)}
      addDialog={
        <SshAddConnectionDialog
          open={addOpen}
          {...(editing ? { title: WEBUI_SSH_EDIT_CONNECTION_TITLE } : {})}
          manual={manual}
          {...(manual ? { manualForm: hostForm } : {})}
          {...(snapshot.discovery ? { discovery: snapshot.discovery } : {})}
          loading={snapshot.status === "loading"}
          {...(selected === undefined ? {} : { selected })}
          {...(error === undefined ? {} : { error })}
          onSelect={(alias) => setSelected(alias)}
          onManual={() => {
            setManual(true);
            setError(undefined);
          }}
          onConfirm={confirmAdd}
          onRefresh={() => {
            void props.owner.loadDiscovery();
          }}
          onClose={closeAdd}
        />
      }
      detailsDialog={
        <SshConnectionDetailsDialog
          open={details !== undefined}
          {...(details ? { connection: details } : {})}
          onEdit={() => {
            const connection = details;
            setDetails(undefined);
            if (!connection) return;
            setEditing(connection);
            setManual(true);
            setError(undefined);
            setAddOpen(true);
            void props.owner.loadDiscovery();
          }}
          onDelete={() => {
            const connection = details;
            setDetails(undefined);
            if (connection) setRemoving(connection);
          }}
          onClose={() => setDetails(undefined)}
        />
      }
      removeDialog={
        <SshRemoveConnectionDialog
          open={removing !== undefined}
          {...(removing ? { connection: removing } : {})}
          onConfirm={confirmRemove}
          onClose={() => setRemoving(undefined)}
        />
      }
    />
  );
}

/** It asks before it drops a connection: the projects rooted on it go with it. */
function SshRemoveConnectionDialog(props: {
  readonly open: boolean;
  readonly connection?: WebuiSshConnection;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): ReactElement | null {
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();
  const connection = props.connection;
  if (!connection) return null;
  return (
    <WebuiDialog
      id="ssh-remove-connection-dialog"
      open={props.open}
      title="删除 SSH 连接"
      description={`删除 ${connection.displayName}，这个连接上的项目会一起移除。远端开发机上的任务和文件会保留。`}
      onClose={props.onClose}
      dismissOnEscape
      width="standard"
      portalTarget={portalTarget}
      testId="ssh-remove-connection-dialog"
      footer={
        <>
          <WebuiButton variant="secondary" size="dialog" data-webui-ssh-remove-cancel="true" onClick={props.onClose}>
            取消
          </WebuiButton>
          <WebuiButton variant="danger" size="dialog" data-webui-ssh-remove-confirm="true" onClick={props.onConfirm}>
            删除
          </WebuiButton>
        </>
      }
    >
      <p className="text-sm text-text_default_secondary">
        这个连接下的 SSH 项目会一起移除。
      </p>
    </WebuiDialog>
  );
}
