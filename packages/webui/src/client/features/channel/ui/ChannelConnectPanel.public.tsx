// The published surface of the 接入 IM pane.
//
// The shell is a peer of this business and may only import what the business publishes, and a
// published module may not re-export another module's symbol — so the pane lives here and is
// published as itself rather than through a forwarding file.
//
// Split in two on purpose. `ChannelConnectPanelView` is a pure render of a snapshot, so a test can
// pin every branch — the rows, the empty state, the load failure, the create menu, the two card
// shapes, the sections the runtime has no route behind — through `renderToStaticMarkup` without a
// DOM (there is no jsdom in this package). `ChannelConnectPanel` is the thin part that
// subscribes to the owner and reads once when it opens.
//
// The pane: a 220px list column with one row per bot (a status dot, the platform's icon, the
// bot's name and the platform's label), the create action under the rows, and, beside it, the
// selected bot's card.
//
// ## The two card shapes
//
// The card is drawn from one fact: the bot's state. A bound bot carries the association's bound
// copy, 解除连接 and no QR. A bot that has not finished its authorization carries the unbound copy,
// 刷新二维码 and the QR itself — including while it is authorizing, which is why a pending scan is
// listed as 未绑定 rather than as a bound bot.
//
// ## The create flow
//
// The create action opens the platform menu. Choosing one creates the bot first (the runtime's
// own prepare route) and authorizes it second:
//
//   * 微信 — the QR authorization. The runtime owns that route; the pane shows the QR it produced
//     and reads the authorization until it is confirmed.
//   * 飞书 — the credential form. This runtime has no onboarding route for Feishu, and the
//     credential path is the one it does serve, so the form asks for the app id and secret instead
//     of showing a QR.
//
// A section the runtime has no route behind is rendered with its own copy and marked as not
// wired, never as if it worked.
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
  webuiChannelAssociationLabel,
  webuiChannelFilterModeLabel,
  webuiChannelProjectLabel,
  webuiChannelRows,
  webuiChannelStateLabel,
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
  readonly onSelect: (connectionId: string) => void;
  /** Creates the bot for one platform — the create menu's action. */
  readonly onAdd: (platform: "wechat" | "feishu") => void;
  /** Starts the bot's authorization over — the 刷新二维码 action. */
  readonly onRefreshAuthorization: (connectionId: string) => void;
  readonly onUnbind: (connectionId: string) => void;
  readonly onDelete: (connectionId: string) => void;
  readonly onBind: (request: WebuiChannelConnectRequest) => void;
  readonly onUpdateFilter: (request: WebuiChannelMessageFilterRequest) => void;
  /** Whether the platform menu is open. */
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
  /** Whether the delete confirmation is open. */
  readonly deleting: boolean;
  readonly onOpenDelete: () => void;
  readonly onCloseDelete: () => void;
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

/** One section of the detail card: a title, a description and its content. */
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
 * A selector the pane draws as a dropdown trigger.
 *
 * The value it shows is real — the Agent the bot talks to, the working directory it keeps its
 * conversations in — but choosing another one has no route behind it here, so the control carries
 * the dropdown's shape, the `aria-disabled` state and no handler.
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
 * The electron app binds Feishu by a QR code and a link; this runtime has no onboarding
 * route for it, and the credential path is the one it does serve, so the form asks for the app
 * id and the secret and binds through the runtime's connect route — onto the bot the create
 * flow already prepared.
 */
function ChannelBindForm(props: {
  readonly connectionId: string;
  readonly onSubmit: (request: WebuiChannelConnectRequest) => void;
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
          connectionId: props.connectionId,
          ...(appId.trim() === "" ? {} : { appId: appId.trim() }),
          ...(appSecret === "" ? {} : { appSecret }),
        });
      }}
    >
      <WebuiFormLayout>
        <p className="text-sm leading-5 text-text_default_primary">{WEBUI_CHANNEL_SECTION_BIND}</p>
        <WebuiField
          label="客户端名称"
          control={(fieldProps) => (
            <WebuiTextInput
              {...fieldProps}
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
          control={(fieldProps) => (
            <WebuiTextInput
              {...fieldProps}
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
          control={(fieldProps) => (
            <WebuiTextInput
              {...fieldProps}
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
            onClick={() => {
              // The form is local until it is submitted, so cancelling clears it.
              setName("");
              setAppId("");
              setAppSecret("");
            }}

          >
            取消
          </WebuiButton>
        </WebuiFormActions>
      </WebuiFormLayout>
    </form>
  );
}

/**
 * The QR the bot's authorization shows.
 *
 * The card draws the picture the runtime produced; when the runtime answers with text instead
 * of an image, that text is encoded as a QR and drawn inline. The WeChat bind route answers with
 * the liteapp link the phone opens, so the text path is the one this authorization usually takes —
 * encoded by the same QR library, at the same size.
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

/** The QR block under an unbound bot's association: the code, then what it is for. */
function AuthorizationBlock(props: {
  readonly row: WebuiChannelRow;
  readonly authorization: WebuiChannelAuthorization | undefined;
}): ReactElement {
  return (
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
  );
}

/**
 * The selected bot's card.
 *
 * One component, two shapes, decided by the bot's state: bound means
 * the association's bound copy and 解除连接; anything else means the unbound copy and the surface
 * that finishes the authorization — a QR for WeChat, the credential form for Feishu.
 */
function ChannelCard(props: {
  readonly row: WebuiChannelRow;
  readonly projectLabel: string;
  readonly snapshot: WebuiChannelSnapshot;
  readonly onRefreshAuthorization: (connectionId: string) => void;
  readonly onUnbind: (connectionId: string) => void;
  readonly onBind: (request: WebuiChannelConnectRequest) => void;
  readonly onUpdateFilter: (request: WebuiChannelMessageFilterRequest) => void;
  readonly onOpenDelete: () => void;
}): ReactElement {
  const filter = props.snapshot.filter;
  const filterKey = props.snapshot.connections.find(
    (entry) => entry.connectionId === props.row.connectionId,
  )?.binding?.externalId;
  const unboundSurface =
    props.row.platform === "feishu" ? (
      <ChannelBindForm connectionId={props.row.connectionId} onSubmit={props.onBind} />
    ) : props.row.platform === "wechat" ? (
      <AuthorizationBlock row={props.row} authorization={props.snapshot.authorization} />
    ) : (
      <div className="flex min-h-14 items-center py-2">
        <NotWired />
      </div>
    );
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
            {props.row.bound ? null : <span>{props.row.platformLabel}</span>}
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
              {props.row.bound
                ? webuiChannelAssociationLabel(props.row.platform)
                : WEBUI_CHANNEL_SECTION_BIND_QR}
            </p>
          </div>
          <WebuiInline gap="small" className="shrink-0">
            {props.row.bound ? (
              <WebuiButton
                variant="quiet-secondary"
                size="inline"
                data-webui-channel-unbind="true"
                onClick={() => props.onUnbind(props.row.connectionId)}
              >
                {WEBUI_CHANNEL_SECTION_UNBIND}
              </WebuiButton>
            ) : props.row.platform === "wechat" ? (
              // A QR is the one authorization this pane drives itself, so it is the one shape that
              // carries the 刷新二维码 action.
              <WebuiButton
                variant="quiet-secondary"
                size="inline"
                data-webui-channel-refresh-authorization="true"
                onClick={() => props.onRefreshAuthorization(props.row.connectionId)}
              >
                {WEBUI_CHANNEL_SECTION_BIND_QR_REFRESH}
              </WebuiButton>
            ) : null}
          </WebuiInline>
        </div>
        {props.row.bound ? null : unboundSurface}
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
          label={props.projectLabel}
          testId="web-project-setting-value"
        />
        <NotWired />
      </DetailSection>

      {props.row.bound && filterKey !== undefined ? (
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
      ) : null}

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
  const rows = webuiChannelRows(props.snapshot.connections, props.snapshot.selectedId);
  const selected = rows.find((row) => row.selected);
  const selectedConnection = props.snapshot.connections.find(
    (entry) => entry.connectionId === props.snapshot.selectedId,
  );
  // "No IM bot exists" is only true of a *successful* empty read: a failed one is not empty, and
  // saying so would invite the reader to create a bot they may already have.
  const showEmpty = rows.length === 0 && props.snapshot.status === "ready";
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
                key={row.connectionId}
                aria-pressed={row.selected}
                data-webui-channel-row={row.connectionId}
                onClick={() => props.onSelect(row.connectionId)}
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
                  props.onAdd(option.key);
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
          {selected === undefined ? (
            showEmpty ? (
              <p className="py-3 text-sm text-text_default_secondary">{WEBUI_CHANNEL_EMPTY_TEXT}</p>
            ) : null
          ) : (
            <ChannelCard
              row={selected}
              projectLabel={webuiChannelProjectLabel(selectedConnection?.projectKey ?? null)}
              snapshot={props.snapshot}
              onRefreshAuthorization={props.onRefreshAuthorization}
              onUnbind={props.onUnbind}
              onBind={props.onBind}
              onUpdateFilter={props.onUpdateFilter}
              onOpenDelete={props.onOpenDelete}
            />
          )}
        </section>
      </WebuiInline>
    </WebuiInline>
  );
}

/** How often the pane reads the authorization one bot's card is showing. */
const AUTHORIZATION_POLL_MS = 2_000;

export function ChannelConnectPanel(props: ChannelConnectPanelProps): ReactElement {
  const snapshot = useSyncExternalStore(
    props.owner.subscribe,
    props.owner.getSnapshot,
    props.owner.getSnapshot,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { dom } = useWebuiBrowserCapabilities();
  const portalTarget = dom.portalTarget();

  useEffect(() => {
    void props.owner.load();
    return props.owner.startRefreshing();
  }, [props.owner]);

  // The first bot's card is shown as soon as the list has one, so the detail column is never
  // empty beside a populated list. "First" is the first *row*: the list is grouped by platform, and
  // the row at the top is the one the card opens on.
  useEffect(() => {
    if (snapshot.selectedId !== undefined) return;
    const first = webuiChannelRows(snapshot.connections)[0];
    if (!first) return;
    void props.owner.select(first.connectionId);
  }, [props.owner, snapshot.connections, snapshot.selectedId]);

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

  const selected = snapshot.connections.find(
    (entry) => entry.connectionId === snapshot.selectedId,
  );

  return (
    <>
      <ChannelConnectPanelView
        snapshot={snapshot}
        onSelect={(connectionId) => void props.owner.select(connectionId)}
        onAdd={(platform) => void props.owner.addBot(platform)}
        onRefreshAuthorization={(connectionId) => void props.owner.refreshAuthorization(connectionId)}
        onUnbind={(connectionId) => void props.owner.disconnect(connectionId)}
        onDelete={(connectionId) => void props.owner.deleteBot(connectionId)}
        onBind={(request) => void props.owner.connect(request)}
        onUpdateFilter={(request) => void props.owner.updateMessageFilter(request)}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        deleting={deleting}
        onOpenDelete={() => setDeleting(true)}
        onCloseDelete={() => setDeleting(false)}
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
                  void props.owner.deleteBot(selected.connectionId);
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
