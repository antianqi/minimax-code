// The Git-import dialog: the marketplace's "从 Git 仓库导入插件" surface.
//
// The catalogue keeps its shared dialog instance mounted and drives its open state, while it owns no
// form state: the URL, the preview and the busy/error flags are
// the catalogue's, which is what keeps a failed preview from discarding what the user typed
// (`previewPlugin` sets the error and leaves the preview alone) and a failed import from closing the
// dialog (`importPlugin` closes and clears only after `mutate` reports success).

import { useState, type ReactElement } from "react";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import { readWebuiPluginRow as read, type WebuiPluginRow as Row } from "../contracts/plugin-rows.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiField, WebuiTextInput, useWebuiFormValidation } from "../../../ui/field.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { FeedbackError, FeedbackLiveRegion } from "../../../ui/feedback.js";

export interface PluginImportDialogProps {
  readonly open: boolean;
  readonly url: string;
  /** A keystroke clears the preview: the shown package no longer answers the URL. */
  readonly onUrlChange: (value: string) => void;
  readonly preview: Row | undefined;
  readonly error: string;
  readonly busy: boolean;
  readonly onPreview: () => void;
  readonly onImport: () => void;
  readonly onClose: () => void;
}

export function PluginImportDialog({ open, url, onUrlChange, preview, error, busy, onPreview, onImport, onClose }: PluginImportDialogProps): ReactElement {
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();
  const { errors, validateRequired, clearFieldError } = useWebuiFormValidation();
  const previewIfValid = (): void => {
    if (validateRequired([{ name: "url", label: "仓库 URL", value: url }])) onPreview();
  };
  return (
      <WebuiDialog
        id="plugin-import-dialog"
        open={open}
        title="从 Git 仓库导入插件"
        description="输入 GitHub 插件仓库或子目录 URL"
        onClose={onClose}
        dismissOnEscape
        width="standard"
        portalTarget={portalTarget}
        footer={
          <>
            <WebuiButton variant="secondary" size="dialog" onClick={onClose}>
              取消
            </WebuiButton>
            {preview ? (
              <WebuiButton
                variant="primary"
                size="dialog" disabled={busy || preview.canImport !== true}
                onClick={onImport}
              >
                导入插件
              </WebuiButton>
            ) : (
              <WebuiButton
                variant="primary"
                size="dialog" disabled={busy}
                onClick={previewIfValid}
              >
                预览
              </WebuiButton>
            )}
          </>
        }
      >
        <div className="webui-plugin-import-body">
          <WebuiField
            className="wide"
            label="仓库 URL"
            required
            error={errors.url}
            control={(props) => (
              <WebuiTextInput
                {...props}
                value={url}
                onChange={(event) => {
                  onUrlChange(event.currentTarget.value);
                  clearFieldError("url");
                }}
                placeholder="https://github.com/owner/repository"
              />
            )}
          />
          {preview ? (
            <div className="webui-plugin-import-preview">
              <strong>
                {read(
                  ((preview.plugin as Row)?.summary as Row) || {},
                  "displayName",
                  "name",
                )}
              </strong>
              <p>
                {read(
                  ((preview.plugin as Row)?.summary as Row) || {},
                  "description",
                )}
              </p>
              <span>
                技能{" "}
                {String((preview.plugin as Row)?.skillCount ?? 0)} ·
                MCP{" "}
                {String((preview.plugin as Row)?.mcpServerCount ?? 0)}
              </span>
              {preview.canImport !== true ? (
                /* 诊断清单是一个要被听到的状态，播报通道交给共享契约；
                   列表本身仍是 ul，列表语义不丢。 */
                <FeedbackLiveRegion>
                  <ul className="webui-plugin-diagnostics">
                    {Array.isArray(preview.diagnostics) &&
                    preview.diagnostics.length > 0 ? (
                      (preview.diagnostics as Row[]).map(
                        (diagnostic, index) => (
                          <li key={`${read(diagnostic, "code")}-${index}`}>
                            {[
                              read(diagnostic, "code"),
                              read(diagnostic, "capability", "name"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </li>
                        ),
                      )
                    ) : (
                      <li>当前插件包还不能导入，请检查仓库内容后重试。</li>
                    )}
                  </ul>
                </FeedbackLiveRegion>
              ) : null}
            </div>
          ) : null}
        </div>
        {error ? (
          <FeedbackError message=<>error</> className="webui-plugin-error" />
        ) : null}
      </WebuiDialog>
  );
}
