// The home composer's project row: the workspace picker, its recent list and the
// directory browser it opens.
//
// This was the tail of the `WebuiComposer` render. It is the unit that
// carries where the composer sits on the home surface: the row lives INSIDE the
// scrim container rather than beside it, because `.message-input-home-container`
// is the light surface that already wraps the card — sharing that box is what
// makes the card and the band one continuous surface instead of two stacked
// boxes meeting along a seam.
//
// It owns the state only it uses (whether the directory browser is showing).
// The recent list is a `WebuiDropdown`, so the shared skeleton dismisses it and
// gives it the surface and the motion every other dropdown in the client has;
// the directory browser it opens is a dialog, not a dropdown, and registers as
// a layer of its own, so the coordinator dismisses it and it keeps no listener.
// The menu's open state stays a prop because the shell owns it.

import { useState } from "react";

import { WebuiDropdown } from "../../../ui/Dropdown.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { workspaceProjectName } from "../../../features/workspace/projection/workspace-name.public.js";
import { WebuiWorkspaceDirectoryBrowser } from "../../../features/workspace/ui/WebuiWorkspaceDirectoryBrowser.public.js";
import { WebuiIconCheck, WebuiIconFolder } from "../../../shell/icons.js";

export interface WebuiComposerProjectRowProps {
  /** The directory the next session would use, or `undefined` for none. */
  readonly projectDir: string | undefined;
  /** Directories offered as `最近`, newest first. */
  readonly recentDirs: readonly string[];
  /** Whether this row's menu is open. The shell owns the cell. */
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  /** The chosen directory; `undefined` means "不需要项目". */
  readonly onSelectProject: (dir: string | undefined) => void;
}

export function WebuiComposerProjectRow({
  projectDir,
  recentDirs,
  menuOpen,
  onMenuOpenChange,
  onSelectProject,
}: WebuiComposerProjectRowProps) {
  const [browserOpen, setBrowserOpen] = useState(false);
  const { dom } = useWebuiBrowserCapabilities();

  return (
    <div className="webui-workspace-bar" data-webui-workspace-toolbar="true">
      <div className="relative">
        <WebuiDropdown
          managed
          managedLayerId="composer-project-row"
          open={menuOpen}
          onOpen={() => onMenuOpenChange(true)}
          onClose={() => onMenuOpenChange(false)}
          role="listbox"
          ariaLabel="工作目录"
          align="start"
          // The row sits in the middle of the composer, and the list is taller
          // than the space below it on a short window: opened downwards it ran
          // off the bottom of the screen with its last rows unreachable. It
          // opens upwards, and the clamp keeps it inside the viewport when
          // even upwards does not fit.
          side="top"
          collision="clamp"
          wrapperClassName="webui-workspace-picker"
          className="webui-workspace-picker-menu"
          trigger={(triggerProps) => (
            <WebuiButton variant="plain" size="compact"
              type="button"
              {...triggerProps}
              data-webui-workspace-picker="true"
              className="webui-workspace-bar-trigger"
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                <WebuiIconFolder />
              </span>
              <span className="min-w-0 flex-1 truncate whitespace-nowrap leading-5">
                {projectDir ? workspaceProjectName(projectDir) : "选择文件夹"}
              </span>
            </WebuiButton>
          )}
        >
          {/* A `最近` group of workspaces the user has actually
           * been in, a rule, then the two commands. The group is omitted
           * entirely when there is no history — an empty `最近` header above a
           * divider reads as a broken panel. */}
          {recentDirs.length > 0 ? (
            <>
              <div className="webui-workspace-menu-header" aria-hidden="true">
                最近
              </div>
              {recentDirs.map((dir) => {
                const active = dir === projectDir;
                return (
                  <WebuiButton variant="plain" size="regular"
                    key={dir}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-webui-workspace-recent={dir}
                    className="webui-workspace-option"
                    title={dir}
                    onClick={() => onSelectProject(dir)}
                  >
                    <WebuiIconFolder className="flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {workspaceProjectName(dir)}
                    </span>
                    {active ? <WebuiIconCheck className="webui-workspace-option-check" /> : null}
                  </WebuiButton>
                );
              })}
              <div className="webui-workspace-menu-separator" role="separator" />
            </>
          ) : null}
          <WebuiButton variant="plain" size="regular"
            type="button"
            role="option"
            aria-selected={false}
            data-webui-workspace-action="add-new"
            className="webui-workspace-option"
            onClick={() => {
              onMenuOpenChange(false);
              setBrowserOpen(true);
            }}
          >
            <WebuiIconFolder className="flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              选择新项目
            </span>
          </WebuiButton>
          <WebuiButton variant="plain" size="regular"
            type="button"
            role="option"
            aria-selected={projectDir === undefined}
            data-webui-workspace-action="no-project"
            className="webui-workspace-option"
            onClick={() => onSelectProject(undefined)}
          >
            <WebuiIconFolder className="flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              不需要项目
            </span>
          </WebuiButton>
        </WebuiDropdown>
        <WebuiDialog
          id="composer-directory-browser"
          open={browserOpen}
          title="选择项目目录"
          description="选择要用于新会话的工作目录"
          width="standard"
          portalTarget={dom.portalTarget()}
          onClose={() => setBrowserOpen(false)}
          dismissOnEscape
          dismissOnBackdrop
          testId="webui-workspace-browser-dialog"
          dataAttributes={{ "data-webui-workspace-browser-dialog": "true" }}
          bodyClassName="webui-workspace-browser-dialog-body"
        >
          <WebuiWorkspaceDirectoryBrowser
            initialDir={projectDir}
            onSelect={(dir) => {
              setBrowserOpen(false);
              onSelectProject(dir);
            }}
            onCancel={() => setBrowserOpen(false)}
          />
        </WebuiDialog>
      </div>
    </div>
  );
}
