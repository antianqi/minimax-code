// One file's diff: the heading a reader expands, the unified or split body, and
// the rows it renders.
//
// This is a content view, not panel layout. It was `WebuiDiffFileSectionView`
// inside `WorkspacePanels.tsx`, where it sat between the panel's sizing state
// and its render — two responsibilities that were only neighbours by accident.
// The workspace review and the turn review both mount it, so it is the panel's
// stable content unit; the panel decides where it goes.
//
// The highlighting it reads is `projection/file-highlight.ts`'s: this module
// carries no grammar table and no highlighting fallback of its own.

import { memo, useMemo, useState, type ReactElement } from "react";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDisclosure, WebuiMotionSlot } from "../../../ui/page.js";
import { FeedbackLiveRegion } from "../../../ui/feedback.js";
import { useWebuiToastError } from "../../../ui/toast.js";
import { WebuiIconChevronRight, WebuiIconDiffFile } from "../../../shell/icons.js";
import {
  projectWebuiSplitDiffRows,
  projectWebuiUnifiedDiffLines,
} from "../projection/panel-projection.js";
import { highlightFileLine, webuiFileLanguage } from "../projection/file-highlight.js";
import {
  WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE,
  type WebuiDiffFileEntry,
} from "../../../projection/common/diff-workspace-boundary.js";

function WebuiDiffFileSectionView({ file, selected, loading = false, error, onSelect, onOpenOutsideFile, defaultOpen = true, diffLayout = "unified", showContext = true }: { readonly file: WebuiDiffFileEntry; readonly selected: boolean; readonly loading?: boolean; readonly error?: string; readonly onSelect?: (path: string) => void; readonly onOpenOutsideFile?: (path: string) => void; readonly defaultOpen?: boolean; readonly diffLayout?: "unified" | "split"; readonly showContext?: boolean }): ReactElement {
  const [expanded, setExpanded] = useState(defaultOpen);
  // The diff could not be loaded: the failure is said once, as a toast, and is
  // not drawn in the layout.
  useWebuiToastError(error);
  const diff = file.withinWorkspace && typeof file.diff === "string" ? file.diff : "";
  const allLines = useMemo(() => projectWebuiUnifiedDiffLines(diff), [diff]);
  const lines = useMemo(() => allLines.filter((line) => showContext || line.kind !== "context"), [allLines, showContext]);
  const splitRows = useMemo(() => projectWebuiSplitDiffRows(allLines).filter((row) => showContext || row.kind !== "context"), [allLines, showContext]);
  const language = webuiFileLanguage(file.file);
  const highlightedByContent = useMemo(() => {
    const highlighted = new Map<string, string | undefined>();
    for (const line of allLines) {
      if (line.kind !== "hunk" && line.kind !== "noNewline" && !highlighted.has(line.content))
        highlighted.set(line.content, highlightFileLine(line.content, language));
    }
    return highlighted;
  }, [allLines, language]);
  return <section className="webui-turn-review-file" data-expanded={expanded} data-testid="turn-review-diff-file">
    <WebuiButton variant="plain" size="regular" type="button" className="webui-turn-review-file-heading" aria-current={selected ? "true" : undefined} aria-expanded={expanded} onClick={() => { onSelect?.(file.file); setExpanded((value) => !value); }}>
      <WebuiMotionSlot kind="disclosure-transform" rotation={expanded ? 90 : 0}>
        <WebuiIconChevronRight className="webui-turn-review-chevron" />
      </WebuiMotionSlot>
      <span className="webui-diff-file-icon"><WebuiIconDiffFile fileName={file.file} /></span>
      <span className="webui-turn-review-file-path">{file.file}</span>
      <span className="webui-diff-add">+{file.additions}</span>
      {file.deletions > 0 ? <span className="webui-diff-del">-{file.deletions}</span> : null}
    </WebuiButton>
    <WebuiDisclosure as="div" open={expanded} className="webui-diff-file-disclosure">
      <div>
        {!file.withinWorkspace
          /* The file is outside the workspace, so its content is not shown. The
           * entry stays in the list: the file name and the counts are the part a
           * person can still act on. */
          ? <div className="webui-turn-review-unavailable" data-testid="turn-review-outside-workspace"><p>{WEBUI_DIFF_OUTSIDE_WORKSPACE_NOTICE}</p>{onOpenOutsideFile && (file.file.startsWith("/") || /^[a-z]:[\\/]/iu.test(file.file)) ? <WebuiButton variant="quiet-highlight" size="content" type="button" data-testid="turn-review-open-outside-file" onClick={() => onOpenOutsideFile(file.file)}>在文件查看器中打开</WebuiButton> : null}</div>
          /* 加载中的差异是一条播报；播报通道交给共享契约，类名不变，样式继续命中。 */
      : loading ? <FeedbackLiveRegion className="webui-turn-review-unavailable">正在加载差异…</FeedbackLiveRegion> : lines.length ? <pre className={`webui-file-code webui-turn-review-code${diffLayout === "split" ? " webui-turn-review-code--split" : ""}`} style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${lines.length * 19.8}px` }}><code className={language ? `hljs language-${language}` : ""}>{diffLayout === "split" ? splitRows.map((row, index) => {
        if (row.kind === "hunk" || row.kind === "noNewline") {
          return <span className={`webui-turn-review-line webui-turn-review-line--${row.kind}`} key={`${index}-${row.kind}`}><span className="webui-turn-review-hunk">{row.content}</span></span>;
        }
        const oldContent = row.oldLine;
        const newContent = row.newLine;
        const oldHighlight = oldContent ? highlightedByContent.get(oldContent.content) : undefined;
        const newHighlight = newContent ? highlightedByContent.get(newContent.content) : undefined;
        return <span className={`webui-turn-review-line webui-turn-review-line--split webui-turn-review-line--${row.kind}`} key={`${index}-${row.kind}`}>
          <span className={`webui-turn-review-split-side${oldContent?.kind === "deletion" ? " is-deletion" : ""}`}>
            <span className="webui-turn-review-line-number">{oldContent?.oldLine ?? ""}</span>
            <span className="webui-turn-review-source">{oldContent ? oldHighlight === undefined ? oldContent.content : <span dangerouslySetInnerHTML={{ __html: oldHighlight }} /> : ""}</span>
          </span>
          <span className={`webui-turn-review-split-side${newContent?.kind === "addition" ? " is-addition" : ""}`}>
            <span className="webui-turn-review-line-number">{newContent?.newLine ?? ""}</span>
            <span className="webui-turn-review-source">{newContent ? newHighlight === undefined ? newContent.content : <span dangerouslySetInnerHTML={{ __html: newHighlight }} /> : ""}</span>
          </span>
        </span>;
      }) : lines.map((line, index) => {
        const highlighted = line.kind === "hunk" || line.kind === "noNewline" ? undefined : highlightedByContent.get(line.content);
        return <span className={`webui-turn-review-line webui-turn-review-line--${line.kind}`} key={`${index}-${line.kind}`}>
          {line.kind === "hunk" ? <span className="webui-turn-review-hunk">{line.content}</span> : line.kind === "noNewline" ? line.content : <>
            <span className="webui-turn-review-line-number">{line.oldLine ?? ""}</span>
            <span className="webui-turn-review-line-number">{line.newLine ?? ""}</span>
            <span className="webui-turn-review-marker">{line.kind === "addition" ? "+" : line.kind === "deletion" ? "−" : " "}</span>
            <span className="webui-turn-review-source">{highlighted === undefined ? line.content : <span dangerouslySetInnerHTML={{ __html: highlighted }} />}</span>
          </>}
        </span>;
      })}</code></pre> : <p className="webui-turn-review-unavailable">当前运行时没有提供该文件的文本 patch。</p>}
      </div>
    </WebuiDisclosure>
  </section>;
}

export const WebuiDiffFileSection = memo(WebuiDiffFileSectionView, (previous, next) =>
  previous.file.file === next.file.file
  && previous.file.additions === next.file.additions
  && previous.file.deletions === next.file.deletions
  && previous.file.status === next.file.status
  && previous.file.diff === next.file.diff
  && previous.file.patch === next.file.patch
  && previous.file.withinWorkspace === next.file.withinWorkspace
  && previous.selected === next.selected
  && previous.loading === next.loading
  && previous.error === next.error
  && previous.onSelect === next.onSelect
  && previous.onOpenOutsideFile === next.onOpenOutsideFile
  && previous.defaultOpen === next.defaultOpen
  && previous.diffLayout === next.diffLayout
  && previous.showContext === next.showContext,
);
