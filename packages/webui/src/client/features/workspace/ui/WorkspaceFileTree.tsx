// Owns the workspace file-tree feature: the recursive tree component and the
// file lookup/filter helpers. A different implementer works in this file; the
// container in `WorkspacePanels.tsx` only imports from it.

import { memo, type ReactElement, type ReactNode } from "react";
import type { WebuiWorkspaceFile } from "../../../../shared/contracts/workspace.js";
import { WebuiIconChevronRight, WebuiIconFileForName } from "../../../shell/icons.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDisclosure, WebuiMotionSlot } from "../../../ui/page.js";
import { FeedbackLiveRegion } from "../../../ui/feedback.js";
import { useWebuiToastError } from "../../../ui/toast.js";

// The pure tree helpers moved to `features/workspace/projection/workspace-file-tree.ts`
// so the tree query owner merges with the same function the component walks with.
// Re-exported here so this module's public surface is unchanged.
export {
  filterWorkspaceFiles,
  mergeWorkspaceFileChildren,
  findWorkspaceFile,
  getWorkspaceFileParentPaths,
} from "../projection/workspace-file-tree.js";

/**
 * A directory whose read failed.
 *
 * The failure is said once, as a toast, and the directory keeps the tree's own
 * empty state: the read that would have filled it did not answer, and the
 * notice says why.
 */
function FileTreeDirectoryFailure({
  message,
  children,
}: {
  readonly message: string;
  readonly children: ReactNode;
}): ReactElement {
  useWebuiToastError(message);
  return <>{children}</>;
}

function FileTreeView({ files, onOpen, expandedPaths, loadingPaths, directoryErrors, onToggle, selectedPath }: { readonly files: readonly WebuiWorkspaceFile[]; readonly onOpen: (file: WebuiWorkspaceFile) => void; readonly expandedPaths: ReadonlySet<string>; readonly loadingPaths: ReadonlySet<string>; readonly directoryErrors: Readonly<Record<string, string>>; readonly onToggle: (file: WebuiWorkspaceFile) => void; readonly selectedPath?: string }): ReactElement {
  return <div className="webui-file-tree">{files.map((file) => {
    const expanded = expandedPaths.has(file.path);
    // The directory's own content, drawn the same way whether or not the read
    // that would have filled it answered.
    const children = file.children?.length
      ? <FileTree files={file.children} onOpen={onOpen} expandedPaths={expandedPaths} loadingPaths={loadingPaths} directoryErrors={directoryErrors} onToggle={onToggle} selectedPath={selectedPath} />
      : <p>此文件夹为空。</p>;
    return <div key={file.path}>
      <WebuiButton variant="selectable-row" size="regular" className="webui-file-tree-row" aria-current={file.path === selectedPath ? "true" : undefined} aria-expanded={file.type === "directory" ? expanded : undefined} aria-busy={file.type === "directory" && loadingPaths.has(file.path) ? "true" : undefined} onClick={() => file.type === "directory" ? onToggle(file) : onOpen(file)}>
        {file.type === "directory" ? (
          <WebuiMotionSlot kind="disclosure-transform" rotation={expanded ? 90 : 0}>
            <WebuiIconChevronRight className="inline size-3" />
          </WebuiMotionSlot>
        ) : <WebuiIconFileForName fileName={file.name} className="inline size-3" />} <span className="min-w-0 flex-1 truncate">{file.name}</span>
      </WebuiButton>
      {file.type === "directory" ? <WebuiDisclosure as="div" open={expanded} mountOnOpen className="webui-file-tree-disclosure">
        <div className="webui-file-tree-children">
          {/* 目录在读取中是一条播报；契约的 div 仍带 role="status"，
              `.webui-file-tree-children > [role="status"]` 继续命中。 */}
          {loadingPaths.has(file.path) ? <FeedbackLiveRegion>正在加载目录…</FeedbackLiveRegion>
            : directoryErrors[file.path] ? <FileTreeDirectoryFailure message={directoryErrors[file.path]}>{children}</FileTreeDirectoryFailure>
              : children}
        </div>
      </WebuiDisclosure> : null}
    </div>;
  })}</div>;
}

export const FileTree = memo(FileTreeView);
