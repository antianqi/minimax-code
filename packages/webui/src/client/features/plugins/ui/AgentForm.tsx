// The agent form unit.
//
// Its four draft fields used to be four `useState` calls in `PluginCatalogue`,
// seeded by `beginAgent` there and handed to the dialog as values and setters.
// The draft now belongs to the form; what leaves it is one typed intent.

import { useState, type ReactElement } from "react";

import {
  readWebuiPluginRow as read,
  readWebuiAgentModel,
  type WebuiPluginRow as Row,
} from "../contracts/plugin-rows.js";
import type { WebuiPluginIntent } from "../contracts/plugin-actions.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDialogActions } from "../../../ui/dialog.js";
import { WebuiField, WebuiTextarea, WebuiTextInput, useWebuiFormValidation } from "../../../ui/field.js";
import { WebuiModelSelect, webuiBareModelValue } from "../../models/ui/ModelSelect.public.js";

export interface AgentFormProps {
  readonly editing: Row | undefined;
  readonly onSubmit: (intent: WebuiPluginIntent) => Promise<boolean>;
  /** Present only when the runtime exposes agent chat. */
  readonly onChatWithAgent?: (name: string) => Promise<void>;
  readonly onClose: () => void;
}

export function AgentForm({
  editing,
  onSubmit,
  onChatWithAgent,
  onClose,
}: AgentFormProps): ReactElement {
  const [name, setName] = useState(
    read(editing ?? {}, "name", "displayName", "display_name"),
  );
  const [description, setDescription] = useState(read(editing ?? {}, "description"));
  const [prompt, setPrompt] = useState(read(editing ?? {}, "systemPrompt", "system_prompt"));
  const [model, setModel] = useState(readWebuiAgentModel(editing ?? {}));
  const { errors, validateRequired, clearFieldError } = useWebuiFormValidation();

  const save = async () => {
    const trimmed = name.trim();
    if (!validateRequired([{ name: "name", label: "名称", value: trimmed, required: editing === undefined }])) return;
    const saved = await onSubmit(
      editing
        ? {
            kind: "updateAgent",
            // The agent's name is its identity on the server, so an update
            // addresses the stored name. Editing the field does not rename it —
            // a rename is a different intent, and silently folding it into the
            // update would target whichever agent matched the new name.
            name: read(editing, "name", "pluginName", "plugin_name", "pluginId", "displayName", "display_name"),
            displayName: trimmed,
            description: description.trim(),
            systemPrompt: prompt,
          }
        : {
            kind: "createAgent",
            name: trimmed,
            displayName: trimmed,
            description: description.trim(),
            systemPrompt: prompt,
            // The chosen model travels in the definition, not in the agent's
            // own fields — an edit never carries one, so this is create-only.
            initialDefinition: {
              name: trimmed,
              description: description.trim(),
              systemPrompt: prompt,
              ...(model.trim() ? { model: model.trim() } : {}),
            },
          },
    );
    if (saved) onClose();
  };

  return (
    <div className="webui-plugin-form webui-agent-form">
      <WebuiField
        label="名称"
        required={!editing}
        error={errors.name}
        control={(props) => (
          <WebuiTextInput {...props} value={name} placeholder="例如：代码审查助手" onChange={(event) => { setName(event.currentTarget.value); clearFieldError("name"); }} />
        )}
      />
      <WebuiField
        label="描述"
        control={(props) => (
          <WebuiTextInput {...props} value={description} placeholder="例如：帮助检查代码质量和潜在问题" onChange={(event) => setDescription(event.currentTarget.value)} />
        )}
      />
      <WebuiField
        label="模型"
        control={(props) => (
          <WebuiModelSelect
            {...props}
            value={model}
            onChange={setModel}
            formatValue={webuiBareModelValue}
            placeholder="使用默认模型"
            defaultLabel="使用默认模型"
          />
        )}
      />
      <WebuiField
        className="wide"
        label="系统提示词"
        control={(props) => (
          <WebuiTextarea {...props} value={prompt} placeholder="描述 Agent 应如何工作和回应" onChange={(event) => setPrompt(event.currentTarget.value)} />
        )}
      />
      <WebuiDialogActions>
        {editing && onChatWithAgent ? (
          <WebuiButton variant="secondary" size="dialog" onClick={() => onChatWithAgent(name)}>
            对话
          </WebuiButton>
        ) : null}
        <WebuiButton variant="secondary" size="dialog" onClick={onClose}>
          取消
        </WebuiButton>
        <WebuiButton variant="primary" size="dialog" onClick={save}>
          保存
        </WebuiButton>
      </WebuiDialogActions>
    </div>
  );
}
