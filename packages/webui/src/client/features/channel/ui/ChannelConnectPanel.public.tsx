// The published surface of the 接入 IM pane.
//
// The shell is a peer of this business and may only import what the business publishes, and a
// published module may not re-export another module's symbol — so the pane lives here and is
// published as itself rather than through a forwarding file.
//
// Split in two on purpose. `ChannelConnectPanelView` is a pure render of a snapshot, so a test
// can pin every branch — the rows, the empty state, the load failure, the create menu, the
// authorization, the sections the runtime has no route behind — through `renderToStaticMarkup`
// without a DOM (there is no jsdom in this package). `ChannelConnectPanel` is the thin part that
// subscribes to the owner and reads once when it opens.
//
// The pane is Desktop 3.1.6's 接入 IM tab, transcribed: a 220px list column with one row per IM
// client (a status dot, the platform's icon, the bot's name and the platform's label), the
// create action under the rows, and, beside it, the selected bot's card.
//
// ## The two card shapes
//
// Desktop draws the card from one flag: a bot that is already bound carries the association's
// bound copy, the 解除连接 action and no QR; a bot that is still waiting for its authorization
// carries the unbound copy, the 刷新二维码 action and the QR itself. The runtime's list reports
// bound bots only, so the list's rows are always the first shape and the create flow is the
// second.
//
// ## The create flow
//
// The create action opens Desktop's platform menu — one entry per platform, each with the
// platform's own icon. Choosing one opens that platform's add surface:
//
//   * 微信 — the QR authorization. The runtime owns that route; the pane shows the QR it produced
//     and reads the authorization until it is confirmed.
//   * 飞书 — the credential form. This runtime has no onboarding route for Feishu, and the
//     credential path is the one it does serve, so the form asks for the app id and secret
//     instead of showing a QR.
//
// A section the runtime has no route behind is rendered with Desktop's own copy and marked as
// not wired, never as if it worked.
import {
  IconBrandTelegram,
  IconBrandWechat,
  IconChevronDown,
  IconMessageCircle,
  IconPlus,
  IconFolder,
} from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";

import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import type {
  WebuiChannelConnectRequest,
  WebuiChannelMessageFilterRequest,
} from "../../../../shared/contracts/channel.js";
import type {
  createWebuiChannelOwner,
  WebuiChannelAuthorization,
  WebuiChannelSnapshot,
} from "../application/channel-owner.js";
import {
  WEBUI_CHANNEL_ADD_OPTIONS,
  WEBUI_CHANNEL_AUTHORIZATION_STARTING,
  WEBUI_CHANNEL_CREATE_BOT_LABEL,
  WEBUI_CHANNEL_EMPTY_TEXT,
  WEBUI_CHANNEL_FILTER_MODE_FULL,
  WEBUI_CHANNEL_FILTER_MODE_RESULT,
  WEBUI_CHANNEL_LOADING_TEXT,
  WEBUI_CHANNEL_NOT_WIRED,
  WEBUI_CHANNEL_RENEW_AUTHORIZATION,
  WEBUI_CHANNEL_SECTION_AGENT,
  WEBUI_CHANNEL_SECTION_AGENT_DESCRIPTION,
  WEBUI_CHANNEL_SECTION_BIND,
  WEBUI_CHANNEL_SECTION_BIND_QR,
  WEBUI_CHANNEL_SECTION_BIND_QR_DESCRIPTION,
  WEBUI_CHANNEL_SECTION_BIND_QR_HINT,
  WEBUI_CHANNEL_SECTION_BIND_QR_REFRESH,
  WEBUI_CHANNEL_SECTION_DELETE,
  WEBUI_CHANNEL_SECTION_DELETE_ACTION,
  WEBUI_CHANNEL_SECTION_DELETE_CONFIRM_DESCRIPTION,
  WEBUI_CHANNEL_SECTION_DELETE_CONFIRM_TITLE,
  WEBUI_CHANNEL_SECTION_DELETE_DESCRIPTION,
  WEBUI_CHANNEL_SECTION_FILTER,
  WEBUI_CHANNEL_SECTION_FILTER_DESCRIPTION,
  WEBUI_CHANNEL_SECTION_UNBIND,
  WEBUI_CHANNEL_SECTION_WORKSPACE,
  WEBUI_CHANNEL_SECTION_WORKSPACE_DESCRIPTION,
  WEBUI_CHANNEL_SECTION_WORKSPACE_EMPTY,
  webuiChannelAssociationLabel,
  webuiChannelFilterModeLabel,
  webuiChannelPendingRow,
  webuiChannelRows,
  type WebuiChannelRow,
} from "../projection/channel-panel.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
import { FeedbackLiveRegion } from "../../../ui/feedback.js";
import { WebuiField, WebuiFormActions, WebuiFormLayout, WebuiTextInput } from "../../../ui/field.js";
import { WebuiInline, WebuiStack } from "../../../ui/layout-primitives.js";
import { WebuiMenuItem } from "../../../ui/menu-item.js";

export interface ChannelConnectPanelProps {
  readonly owner: ReturnType<typeof createWebuiChannelOwner>;
}

export interface ChannelConnectPanelViewProps {
  readonly snapshot: WebuiChannelSnapshot;
  readonly onSelect: (name: string) => void;
  readonly onBind: (request: WebuiChannelConnectRequest) => void;
  readonly onUnbind: (name: string) => void;
  readonly onUpdateFilter: (request: WebuiChannelMessageFilterRequest) => void;
  /** Whether the platform menu is open. */
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  /** Whether the Feishu credential form is open. */
  readonly binding: boolean;
  readonly onOpenBinding: () => void;
  readonly onCloseBinding: () => void;
  /** Whether the delete confirmation is open. */
  readonly deleting: boolean;
  readonly onOpenDelete: () => void;
  readonly onCloseDelete: () => void;
  /** Starts the create flow for one platform. */
  readonly onStartAdding: (platform: "wechat" | "feishu") => void;
  /** Leaves the create flow. */
  readonly onCancelAdding: () => void;
  /** Starts the authorization over — the Desktop's 刷新二维码. */
  readonly onRenewAuthorization: () => void;
}

/** The platform's icon. Feishu has no brand glyph in the icon set, so it gets a neutral one. */
function platformIcon(platform: string): ReactNode {
  if (platform === "wechat") {
    return <IconBrandWechat aria-hidden="true" size={20} stroke={1.5} />;
  }
  if (platform === "telegram") {
    return <IconBrandTelegram aria-hidden="true" size={20} stroke={1.5} />;
  }
  return <IconMessageCircle aria-hidden="true" size={20} stroke={1.5} />;
}

/** One section of the detail card, in Desktop's shape: a title, a description and its content. */
function DetailSection(props: {
  readonly title: string;
  readonly description: string;
  readonly testId: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <section
      className="flex min-h-[72px] items-center justify-between gap-6 border-t-[0.5px] border-border_default py-3"
      data-webui-channel-section={props.testId}
    >
      <div className="min-w-0">
        <p className="text-sm leading-5 text-text_default_primary">{props.title}</p>
        <p className="mt-1 text-xs leading-4 text-text_default_secondary">{props.description}</p>
      </div>
      <WebuiInline gap="small" className="shrink-0">{props.children}</WebuiInline>
    </section>
  );
}

/** The marker for a section the runtime has no route behind. */
function NotWired(): ReactElement {
  return (
    <span
      data-webui-channel-not-wired="true"
      className="rounded-[6px] border border-border_default px-2 py-1 text-xs text-text_default_tertiary"
    >
      {WEBUI_CHANNEL_NOT_WIRED}
    </span>
  );
}

/**
 * A selector the Desktop draws as a dropdown trigger.
 *
 * The value it shows is real — the Agent the client is bound to, the working directory it keeps
 * its conversations in — but choosing another one has no route behind it here, so the control
 * carries the Desktop's shape, the `aria-disabled` state and no handler.
 */
function UnwiredSelect(props: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly testId: string;
}): ReactElement {
  return (
    <WebuiInline
      gap="small"
      className="h-8 items-center rounded-lg border-[0.5px] border-border_default px-3 text-sm text-text_default_primary"
      data-testid={props.testId}
      aria-disabled="true"
    >
      {props.icon}
      <span className="min-w-0 truncate">{props.label}</span>
      <IconChevronDown aria-hidden="true" size={16} stroke={1.5} className="text-text_default_secondary" />
    </WebuiInline>
  );
}

/**
 * The Feishu credential form.
 *
 * Desktop binds Feishu by a QR code and a link; this runtime has no onboarding route for it, and
 * the credential path is the one it does serve, so the form asks for the app id and the secret
 * and binds through the runtime's connect route.
 */
function ChannelBindForm(props: {
  readonly onSubmit: (request: WebuiChannelConnectRequest) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  return (
    <form
      data-webui-channel-bind-form="true"
      className="py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() === "") return;
        props.onSubmit({
          name: name.trim(),
          ...(appId.trim() === "" ? {} : { appId: appId.trim() }),
          ...(appSecret === "" ? {} : { appSecret }),
        });
      }}
    >
      <WebuiFormLayout>
        <p className="text-sm leading-5 text-text_default_primary">{WEBUI_CHANNEL_SECTION_BIND}</p>
        <WebuiField
          label="客户端名称"
          control={(props) => (
            <WebuiTextInput
              {...props}
              data-webui-channel-bind-name="true"
              controlSize="compact"
              placeholder="例如：团队飞书机器人"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        />
        <WebuiField
          label="飞书 App ID"
          control={(props) => (
            <WebuiTextInput
              {...props}
              data-webui-channel-bind-app-id="true"
              controlSize="compact"
              placeholder="输入飞书 App ID"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
            />
          )}
        />
        <WebuiField
          label="飞书 App Secret"
          control={(props) => (
            <WebuiTextInput
              {...props}
              data-webui-channel-bind-app-secret="true"
              controlSize="compact"
              placeholder="输入飞书 App Secret"
              value={appSecret}
              onChange={(event) => setAppSecret(event.target.value)}
            />
          )}
        />
        <WebuiFormActions>
          <WebuiButton variant="outline" size="inline" type="submit"
            data-webui-channel-bind-submit="true"

          >
            绑定
          </WebuiButton>
          <WebuiButton variant="quiet-highlight" size="inline" data-webui-channel-bind-cancel="true"
            onClick={props.onCancel}

          >
            取消
          </WebuiButton>
        </WebuiFormActions>
      </WebuiFormLayout>
    </form>
  );
}

/**
 * The QR the WeChat authorization shows.
 *
 * Desktop draws the picture the runtime produced; when the runtime answers with text instead of
 * an image, Desktop encodes that text as a QR and draws it inline. The WeChat bind route answers
 * with the liteapp link the phone opens, so the text path is the one this authorization takes —
 * encoded by the same library Desktop uses, at the same size.
 */
function AuthorizationQr(props: {
  readonly authorization: WebuiChannelAuthorization | undefined;
}): ReactElement {
  const authorization = props.authorization;
  const image = authorization?.qrImageUrl;
  const content = authorization?.qrContent;
  return (
    <div
      className="relative flex h-40 w-40 shrink-0 items-center justify-center rounded-xl bg-bg_default_primary p-[10px]"
      data-testid="authorization-qr-container"
    >
      {image !== undefined ? (
        <img
          src={image}
          alt=""
          className="h-[140px] w-[140px]"
          data-testid="authorization-qr-image"
        />
      ) : content !== undefined ? (
        <QRCodeSVG
          value={content}
          size={140}
          level="M"
          data-testid="authorization-qr-code"
        />
      ) : (
        <p className="text-center text-xs leading-4 text-text_default_secondary">
          {WEBUI_CHANNEL_AUTHORIZATION_STARTING}
        </p>
      )}
    </div>
  );
}

/**
 * The bot the create flow is adding, as Desktop's card.
 *
 * It is the unbound shape: the header names the bot and its state, the association carries the
 * unbound copy and the 刷新二维码 action, and the QR sits under it.
 */
function ChannelPendingCard(props: {
  readonly row: WebuiChannelRow;
  readonly authorization: WebuiChannelAuthorization | undefined;
  readonly onRenew: () => void;
  readonly onCancel: () => void;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div className="rounded-2xl bg-bg_grouped_tertiary p-4" data-webui-component="channel-detail-card">
      <header className="flex min-h-14 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm leading-5 text-text_default_primary">{props.row.botName}</h1>
          <div className="mt-1 flex items-center gap-1.5 text-xs leading-4 text-text_default_secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-text_default_tertiary" aria-hidden="true" />
            <span>{props.row.platformLabel}</span>
            <span className="text-text_default_secondary" data-testid="connection-state">
              {props.row.stateLabel}
            </span>
          </div>
        </div>
        <WebuiButton
          variant="quiet-secondary"
          size="inline"
          data-webui-channel-cancel-adding="true"
          onClick={props.onCancel}
        >
          取消
        </WebuiButton>
      </header>

      <section
        className="border-t-[0.5px] border-border_default"
        data-webui-channel-section="association"
      >
        <div className="flex min-h-14 items-center justify-between gap-6 py-2">
          <div className="min-w-0">
            <p className="text-sm leading-5 text-text_default_primary">{WEBUI_CHANNEL_SECTION_BIND}</p>
            <p className="mt-1 text-xs leading-4 text-text_default_secondary">
              {WEBUI_CHANNEL_SECTION_BIND_QR}
            </p>
          </div>
          <WebuiInline gap="small" className="shrink-0">
            <WebuiButton
              variant="quiet-secondary"
              size="inline"
              data-webui-channel-refresh-authorization="true"
              onClick={props.onRenew}
            >
              {WEBUI_CHANNEL_SECTION_BIND_QR_REFRESH}
            </WebuiButton>
          </WebuiInline>
        </div>
        {props.children ?? (
          <section
            className="flex h-[176px] w-full items-center gap-4 py-2"
            data-webui-channel-section="authorization"
          >
            <AuthorizationQr authorization={props.authorization} />
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5" data-testid="authorization-copy">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center text-icon_default_primary">
                {platformIcon(props.row.platform)}
              </span>
              <div className="min-w-0">
                <p className="text-sm leading-5 text-text_default_secondary">
                  {WEBUI_CHANNEL_SECTION_BIND_QR_DESCRIPTION}
                </p>
                <p className="text-sm leading-5 text-text_default_secondary">
                  {WEBUI_CHANNEL_SECTION_BIND_QR_HINT}
                </p>
              </div>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

/** The selected bot's card: its header, the association, the Agent, the workspace and the deletion. */
function ChannelDetail(props: {
  readonly row: WebuiChannelRow;
  readonly snapshot: WebuiChannelSnapshot;
  readonly onUnbind: (name: string) => void;
  readonly onUpdateFilter: (request: WebuiChannelMessageFilterRequest) => void;
  readonly onOpenDelete: () => void;
}): ReactElement {
  const filter = props.snapshot.filter;
  const filterKey = props.row.name;
  return (
    <div className="rounded-2xl bg-bg_grouped_tertiary p-4" data-webui-component="channel-detail-card">
      <header className="flex min-h-14 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-sm leading-5 text-text_default_primary">{props.row.botName}</h1>
          <div className="mt-1 flex items-center gap-1.5 text-xs leading-4 text-text_default_secondary">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-text_default_tertiary"
              aria-hidden="true"
            />
            <span className="text-text_default_secondary" data-testid="connection-state">
              {props.row.stateLabel}
            </span>
          </div>
        </div>
      </header>

      <section
        className="border-t-[0.5px] border-border_default"
        data-webui-channel-section="association"
      >
        <div className="flex min-h-14 items-center justify-between gap-6 py-2">
          <div className="min-w-0">
            <p className="text-sm leading-5 text-text_default_primary">{WEBUI_CHANNEL_SECTION_BIND}</p>
            <p className="mt-1 text-xs leading-4 text-text_default_secondary">
              {webuiChannelAssociationLabel(props.row.platform)}
            </p>
          </div>
          <WebuiInline gap="small" className="shrink-0">
            <WebuiButton
              variant="quiet-secondary"
              size="inline"
              data-webui-channel-unbind="true"
              onClick={() => props.onUnbind(props.row.name)}
            >
              {WEBUI_CHANNEL_SECTION_UNBIND}
            </WebuiButton>
          </WebuiInline>
        </div>
      </section>

      <DetailSection
        testId="agent"
        title={WEBUI_CHANNEL_SECTION_AGENT}
        description={WEBUI_CHANNEL_SECTION_AGENT_DESCRIPTION}
      >
        <UnwiredSelect
          icon={<IconMessageCircle aria-hidden="true" size={16} stroke={1.5} />}
          label={props.row.agentLabel}
          testId="web-agent-setting-value"
        />
        <NotWired />
      </DetailSection>

      <DetailSection
        testId="workspace"
        title={WEBUI_CHANNEL_SECTION_WORKSPACE}
        description={WEBUI_CHANNEL_SECTION_WORKSPACE_DESCRIPTION}
      >
        <UnwiredSelect
          icon={<IconFolder aria-hidden="true" size={16} stroke={1.5} />}
          label={WEBUI_CHANNEL_SECTION_WORKSPACE_EMPTY}
          testId="web-project-setting-value"
        />
        <NotWired />
      </DetailSection>

      <DetailSection
        testId="filter"
        title={WEBUI_CHANNEL_SECTION_FILTER}
        description={WEBUI_CHANNEL_SECTION_FILTER_DESCRIPTION}
      >
        <WebuiInline gap="small">
          <WebuiButton variant="outline" size="inline-dense" data-webui-channel-filter-mode="result"
            aria-pressed={filter?.mode !== "full"}
            onClick={() =>
              props.onUpdateFilter({
                agent: filterKey,
                filter: { mode: "result", includeToolSummary: filter?.includeToolSummary === true },
              })
            }

          >
            {WEBUI_CHANNEL_FILTER_MODE_RESULT}
          </WebuiButton>
          <WebuiButton variant="outline" size="inline-dense" data-webui-channel-filter-mode="full"
            aria-pressed={filter?.mode === "full"}
            onClick={() =>
              props.onUpdateFilter({
                agent: filterKey,
                filter: { mode: "full", includeToolSummary: filter?.includeToolSummary === true },
              })
            }

          >
            {WEBUI_CHANNEL_FILTER_MODE_FULL}
          </WebuiButton>
        </WebuiInline>
        <span className="text-xs text-text_default_secondary">
          {filter === undefined ? "" : webuiChannelFilterModeLabel(filter.mode)}
        </span>
      </DetailSection>

      <DetailSection
        testId="delete"
        title={WEBUI_CHANNEL_SECTION_DELETE}
        description={WEBUI_CHANNEL_SECTION_DELETE_DESCRIPTION}
      >
        <WebuiButton
          variant="danger"
          size="inline"
          data-webui-channel-delete="true"
          onClick={props.onOpenDelete}
        >
          {WEBUI_CHANNEL_SECTION_DELETE_ACTION}
        </WebuiButton>
      </DetailSection>
    </div>
  );
}

export function ChannelConnectPanelView(props: ChannelConnectPanelViewProps): ReactElement {
  const rows = webuiChannelRows(props.snapshot.clients, props.snapshot.selectedName);
  const selected = rows.find((row) => row.selected);
  // "No IM client is bound" is only true of a *successful* empty read: a failed one is not empty,
  // and saying so would invite the reader to bind a client they may already have.
  const showEmpty =
    rows.length === 0 && props.snapshot.status === "ready" && props.snapshot.addPlatform === undefined;
  const addPlatform = props.snapshot.addPlatform;
  const pendingRow =
    addPlatform === undefined ? undefined : webuiChannelPendingRow(addPlatform, addPlatform === "wechat" ? "ClawBot" : "新 Bot");
  return (
    <WebuiInline
      align="stretch"
      justify="center"
      data-webui-component="channel-connect-panel"
      className="h-full min-h-0 w-full overflow-hidden px-6 py-10"
    >
      <WebuiInline as="main" gap="medium" align="start" className="mx-auto h-full min-w-0 w-full max-w-[912px]">
        <aside
          className="h-full min-h-0 w-[220px] shrink-0 overflow-y-auto overscroll-contain"
          data-webui-component="channel-connection-list"
        >
          <WebuiStack gap="hairline">
            {rows.map((row) => (
              <WebuiButton
                variant="selectable-row"
                size="regular"
                key={row.name}
                aria-pressed={row.selected}
                data-webui-channel-row={row.name}
                onClick={() => props.onSelect(row.name)}
                className="flex h-[62px] w-full items-center gap-2 rounded-lg py-2.5 pl-2 pr-3 text-left"
              >
                <span
                  className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-text_default_tertiary"
                  aria-hidden="true"
                ></span>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center [&_svg]:!h-8 [&_svg]:!w-8">
                  {platformIcon(row.platform)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium leading-5 text-text_default_primary">
                    {row.botName}
                  </span>
                  <span className="truncate text-[13px] leading-[18px] text-text_default_secondary">
                    {row.platformLabel}
                  </span>
                </span>
              </WebuiButton>
            ))}
          </WebuiStack>
          <WebuiDropdown
            managed
            managedLayerId="channel-create-im-bot"
            open={props.menuOpen}
            onOpen={() => props.onMenuOpenChange(true)}
            onClose={() => props.onMenuOpenChange(false)}
            role="menu"
            ariaLabel={WEBUI_CHANNEL_CREATE_BOT_LABEL}
            align="start"
            side="bottom"
            collision="clamp"
            wrapperClassName="mt-3 block"
            className="w-40"
            trigger={(triggerProps) => (
              <WebuiButton
                variant="quiet-secondary"
                size="inline"
                type="button"
                {...triggerProps}
                data-webui-channel-new="true"
                className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm"
              >
                <IconPlus aria-hidden="true" size={16} stroke={1.5} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{WEBUI_CHANNEL_CREATE_BOT_LABEL}</span>
              </WebuiButton>
            )}
          >
            {WEBUI_CHANNEL_ADD_OPTIONS.map((option) => (
              <WebuiMenuItem
                key={option.key}
                icon={platformIcon(option.key)}
                data-webui-channel-add={option.key}
                onClick={() => {
                  props.onMenuOpenChange(false);
                  props.onStartAdding(option.key);
                }}
              >
                {option.label}
              </WebuiMenuItem>
            ))}
          </WebuiDropdown>
          {props.snapshot.status === "loading" ? (
            <p className="mt-2 text-xs text-text_default_tertiary">{WEBUI_CHANNEL_LOADING_TEXT}</p>
          ) : null}
          {props.snapshot.error === undefined ? null : (
            <p
              data-webui-channel-error="true"
              className="mt-2 text-xs leading-4 text-text_status_error"
            >
              {props.snapshot.error}
            </p>
          )}
          {props.snapshot.actionError === undefined ? null : (
            <p
              data-webui-channel-action-error="true"
              className="mt-2 text-xs leading-4 text-text_status_error"
            >
              {props.snapshot.actionError}
            </p>
          )}
        </aside>

        <section
          className="h-full min-h-0 w-[680px] min-w-0 overflow-y-auto overscroll-contain"
          data-webui-component="channel-connection-detail"
        >
          {pendingRow === undefined ? (
            selected === undefined ? (
              showEmpty ? (
                <p className="py-3 text-sm text-text_default_secondary">{WEBUI_CHANNEL_EMPTY_TEXT}</p>
              ) : null
            ) : (
              <ChannelDetail
                row={selected}
                snapshot={props.snapshot}
                onUnbind={props.onUnbind}
                onUpdateFilter={props.onUpdateFilter}
                onOpenDelete={props.onOpenDelete}
              />
            )
          ) : addPlatform === "feishu" ? (
            <ChannelPendingCard
              row={pendingRow}
              authorization={props.snapshot.authorization}
              onRenew={props.onRenewAuthorization}
              onCancel={props.onCancelAdding}
            >
              {props.binding ? (
                <ChannelBindForm onSubmit={props.onBind} onCancel={props.onCloseBinding} />
              ) : (
                <section
                  className="flex h-[176px] w-full items-center gap-4 py-2"
                  data-webui-channel-section="authorization"
                >
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5" data-testid="authorization-copy">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center text-icon_default_primary">
                      {platformIcon(pendingRow.platform)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm leading-5 text-text_default_secondary">
                        输入飞书 App ID 与 App Secret 以完成绑定
                      </p>
                      <p className="text-sm leading-5 text-text_default_secondary">
                        {WEBUI_CHANNEL_SECTION_BIND_QR_HINT}
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </ChannelPendingCard>
          ) : (
            <ChannelPendingCard
              row={pendingRow}
              authorization={props.snapshot.authorization}
              onRenew={props.onRenewAuthorization}
              onCancel={props.onCancelAdding}
            />
          )}
        </section>
      </WebuiInline>
    </WebuiInline>
  );
}

/** How often the create flow reads the authorization it started. */
const AUTHORIZATION_POLL_MS = 2_000;

export function ChannelConnectPanel(props: ChannelConnectPanelProps): ReactElement {
  const snapshot = useSyncExternalStore(
    props.owner.subscribe,
    props.owner.getSnapshot,
    props.owner.getSnapshot,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [binding, setBinding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();

  useEffect(() => {
    void props.owner.load();
    return props.owner.startRefreshing();
  }, [props.owner]);

  // The Desktop shows the first bot's detail as soon as the list has one, so the card is never
  // an empty column beside a populated list.
  useEffect(() => {
    if (snapshot.selectedName !== undefined) return;
    const first = snapshot.clients[0];
    if (!first) return;
    void props.owner.select(first.name);
  }, [props.owner, snapshot.clients, snapshot.selectedName]);

  // The authorization is the one thing on this page that moves without the host saying anything,
  // so the clock ticks only while one is on screen.
  const authorizationPending = snapshot.authorization?.status === "pending";
  useEffect(() => {
    if (!authorizationPending) return;
    const timer = setInterval(() => {
      void props.owner.readAuthorization();
    }, AUTHORIZATION_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [props.owner, authorizationPending]);

  const selected = snapshot.clients.find((client) => client.name === snapshot.selectedName);

  return (
    <>
      <ChannelConnectPanelView
        snapshot={snapshot}
        onSelect={(name) => void props.owner.select(name)}
        onBind={(request) => {
          void props.owner.connect(request).then((result) => {
            if (result.ok) {
              setBinding(false);
              props.owner.cancelAdding();
            }
          });
        }}
        onUnbind={(name) => {
          void props.owner.disconnect({ name, clearCredentials: true });
        }}
        onUpdateFilter={(request) => void props.owner.updateMessageFilter(request)}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        binding={binding}
        onOpenBinding={() => setBinding(true)}
        onCloseBinding={() => setBinding(false)}
        deleting={deleting}
        onOpenDelete={() => setDeleting(true)}
        onCloseDelete={() => setDeleting(false)}
        onStartAdding={(platform) => {
          void props.owner.startAdding(platform).then((result) => {
            if (result.ok && platform === "feishu") setBinding(true);
          });
        }}
        onCancelAdding={() => {
          setBinding(false);
          props.owner.cancelAdding();
        }}
        onRenewAuthorization={() => {
          void props.owner.renewAuthorization();
        }}
      />
      {deleting && selected && portalTarget ? (
        <WebuiDialog
          id="channel-delete-bot"
          open
          role="alertdialog"
          title={WEBUI_CHANNEL_SECTION_DELETE_CONFIRM_TITLE}
          description={WEBUI_CHANNEL_SECTION_DELETE_CONFIRM_DESCRIPTION}
          width="compact"
          portalTarget={portalTarget}
          testId="delete-connection-confirm"
          onClose={() => setDeleting(false)}
          footer={
            <>
              <WebuiButton
                variant="secondary"
                size="regular"
                data-webui-channel-delete-cancel="true"
                onClick={() => setDeleting(false)}
              >
                取消
              </WebuiButton>
              <WebuiButton
                variant="danger"
                size="regular"
                data-webui-channel-delete-confirm="true"
                onClick={() => {
                  setDeleting(false);
                  void props.owner.disconnect({ name: selected.name, clearCredentials: true });
                }}
              >
                {WEBUI_CHANNEL_SECTION_DELETE_ACTION}
              </WebuiButton>
            </>
          }
        >
          <span data-testid="delete-connection-confirm-description">
            {WEBUI_CHANNEL_SECTION_DELETE_CONFIRM_DESCRIPTION}
          </span>
        </WebuiDialog>
      ) : null}
    </>
  );
}
