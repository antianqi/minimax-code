// The SSH terminal window. xterm owns terminal input and rendering; this view only connects it
// to the SSH owner's existing stream and resize commands.
import { useEffect, useRef, type ReactElement } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { IconCircleFilled, IconTerminal2 } from "@tabler/icons-react";

import type { WebuiSshTerminalSnapshot } from "../application/ssh-owner.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { useWebuiToastError } from "../../../ui/toast.js";

export interface SshTerminalViewProps {
  readonly terminal: WebuiSshTerminalSnapshot;
  readonly onInput: (data: string) => void;
  readonly onResize: (cols: number, rows: number) => void;
  readonly onClose: () => void;
}

export function SshTerminalView(props: SshTerminalViewProps): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const onInputRef = useRef(props.onInput);
  const onResizeRef = useRef(props.onResize);
  const lastOutputRef = useRef("");
  const running = props.terminal.status === "running" && Boolean(props.terminal.terminalId);
  // The terminal that could not open is said once. The toast owns the
  // announcement: this surface authors no channel of its own.
  useWebuiToastError(
    running ? undefined : props.terminal.error ?? "远程终端打开失败。",
  );

  useEffect(() => {
    onInputRef.current = props.onInput;
    onResizeRef.current = props.onResize;
  }, [props.onInput, props.onResize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!running || !host) return;

    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      convertEol: true,
      cursorBlink: true,
      scrollback: 10_000,
      theme: {
        background: "#000000",
        foreground: "#e5e7eb",
        cursor: "#f9fafb",
        selectionBackground: "#374151",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;

    let disposed = false;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const reportSize = () => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!disposed) onResizeRef.current(terminal.cols, terminal.rows);
      }, 100);
    };
    const fitAndReport = () => {
      fit.fit();
      reportSize();
    };
    const stopObserving = dom.observeSize(host, fitAndReport);
    const input = terminal.onData((data) => onInputRef.current(data));

    void dom.whenFontsReady().then(() => {
      if (disposed) return;
      fit.fit();
      onResizeRef.current(terminal.cols, terminal.rows);
      terminal.focus();
    });

    return () => {
      disposed = true;
      if (resizeTimer !== undefined) clearTimeout(resizeTimer);
      stopObserving();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      lastOutputRef.current = "";
    };
  }, [dom, running, props.terminal.terminalId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const output = props.terminal.output;
    const previous = lastOutputRef.current;
    if (output.startsWith(previous)) {
      const fresh = output.slice(previous.length);
      if (fresh) terminal.write(fresh);
    } else {
      terminal.reset();
      if (output) terminal.write(output);
    }
    lastOutputRef.current = output;
  }, [props.terminal.output]);

  return (
    <WebuiDialog
      id="ssh-remote-terminal-dialog"
      title={(
        <span className="webui-ssh-terminal-title">
          <span className="webui-ssh-terminal-title-icon"><IconTerminal2 size={17} stroke={1.8} /></span>
          <span>{props.terminal.alias ?? "SSH"}</span>
        </span>
      )}
      description="交互式远程会话"
      headerActions={(
        <span className={`webui-ssh-terminal-status${running ? " is-connected" : " is-error"}`}>
          <IconCircleFilled size={7} aria-hidden="true" />
          {running ? "已连接" : "连接异常"}
        </span>
      )}
      onClose={props.onClose}
      dismissOnEscape
      width="wide"
      portalTarget={dom.portalTarget()}
      bodyClassName="webui-ssh-terminal-body"
      testId="ssh-remote-terminal-dialog"
      closeTestId="ssh-remote-terminal-close"
      dataAttributes={{ "data-webui-ssh-terminal-surface": "true" }}
    >
      {running
        ? <div
          ref={hostRef}
          data-webui-component="ssh-terminal"
          data-webui-ssh-terminal-output="true"
          aria-label="远程终端"
          className="webui-ssh-xterm-host text-left"
        />
        : null}
    </WebuiDialog>
  );
}
