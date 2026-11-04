import type { ReactElement } from "react";
import { IconRobot } from "@tabler/icons-react";

type AgentRecord = Record<string, unknown>;
type AgentAvatarSize = "tiny" | "compact" | "small" | "large";

const AGENT_AVATAR_SIZE_CLASS: Record<AgentAvatarSize, string> = {
  tiny: "webui-agent-avatar--tiny",
  compact: "webui-agent-avatar--compact",
  small: "webui-agent-avatar--small",
  large: "webui-agent-avatar--large",
};

function recordOf(value: unknown): AgentRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as AgentRecord
    : {};
}

function stringOf(record: AgentRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function avatarSource(agent: AgentRecord): string | undefined {
  const custom = stringOf(agent, "avatarDataUrl", "avatar_data_url");
  if (custom.startsWith("data:image/")) return custom;

  const identity = [
    stringOf(agent, "builtinAvatar", "builtin_avatar"),
    stringOf(agent, "agentRole", "agent_role", "role"),
    stringOf(agent, "agentName", "agent_name", "name"),
  ].join(" ").toLowerCase();

  if (/(^|\W)mavis($|\W)/u.test(identity)) {
    return "/assets/img/minimax-code-agent-icon.png";
  }
  if (/(^|\W)(verifier|verify|validator|reviewer)($|\W)/u.test(identity)) {
    return "/assets/img/agent-avatar-verifier.svg";
  }
  if (/(^|\W)(explore|general|researcher)($|\W)/u.test(identity)) {
    return "/assets/img/agent-avatar-explore.svg";
  }
  if (/(^|\W)(worker|coder)($|\W)/u.test(identity)) {
    return "/assets/img/agent-avatar-worker.svg";
  }
  return undefined;
}

export function WebuiAgentAvatar({ agent, agentName, size }: {
  readonly agent?: unknown;
  readonly agentName?: string;
  readonly size: AgentAvatarSize;
}): ReactElement {
  const details = recordOf(agent);
  const source = avatarSource({ ...details, ...(agentName ? { agentName } : {}) });
  return (
    <span className={`webui-agent-avatar ${AGENT_AVATAR_SIZE_CLASS[size]}`} aria-hidden="true">
      {source
        ? <img src={source} alt="" draggable={false} />
        : <IconRobot className="webui-agent-avatar-fallback" aria-hidden="true" />}
    </span>
  );
}
