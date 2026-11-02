# Component design system

Read this before adding a WebUI component or changing its appearance. Paths below are relative to `packages/webui/`. `src/client/styles/tokens.css` defines the values; `tailwind.config.cjs` defines the utility mappings. `src/client/ui/` plus its stylesheets in `src/client/styles/` are the shared presentation layer that [ADR 0028](../../../../packages/webui/docs/adr/0028-the-webui-has-one-shared-presentation-layer.md) establishes and [ADR 0029](../../../../packages/webui/docs/adr/0029-page-surfaces-share-layout-skeleton-and-motion-contracts.md) extends to page, skeleton and motion contracts. `packages/webui/docs/design/design-language.md` is the document that owns the per-contract rules.

## The shared presentation layer comes first

The client has one shared presentation layer. Every control, page surface, loading placeholder and motion effect that more than one business can render already lives there, and business code renders it. Treat that as the default rather than an option: a business component that styles a control locally is a second definition of a contract that already exists, and the two drift the first time one of them changes.

Before writing a component or any CSS, find the contract you need:

| You are about to build | Render instead | Home |
| --- | --- | --- |
| A button, an icon-only button, a link that looks like one | `WebuiButton`, `WebuiIconButton`, `WebuiButtonLink` (published variants and sizes) | `src/client/ui/button.tsx`, `styles/button.css` |
| A binary setting | `ToggleSwitch` | `src/client/ui/ToggleSwitch.tsx`, `styles/field.css` |
| A labelled control or a form | `WebuiField` with `WebuiTextInput` / `WebuiTextarea` / `WebuiSelect` / `WebuiCheckbox` / `WebuiRadio` / `WebuiFileInput`; `WebuiSearchField`; `WebuiFormLayout`; `WebuiFormActions` | `src/client/ui/field.tsx`, `styles/field.css` |
| A modal | `WebuiDialog` and `WebuiDialogActions` | `src/client/ui/dialog.tsx`, `styles/dialog.css` |
| A menu, popup, list popup or fly-out | `WebuiDropdown`; `WebuiFlyoutSurface` for a fly-out inside a menu | `src/client/ui/Dropdown.tsx`, `styles/dropdown.css`; contract: `packages/webui/docs/client/floating-surfaces.md` |
| A menu row | `WebuiMenuItem`, `WebuiMenuSeparator` | `src/client/ui/menu-item.tsx`, `styles/menu-item.css` |
| A context menu | `WebuiContextMenu` | `src/client/ui/ContextMenu.tsx`, `styles/shell.css` |
| A block/card surface | `WebuiCard` | `src/client/ui/card.tsx`, `styles/card.css` |
| A page, drawer, dialog body or panel with a loading state | `WebuiPage`, with `WebuiSkeletonProjection` for the part a shared structure owns | `src/client/ui/page.tsx`, `styles/motion.css` |
| A loading placeholder | `WebuiSkeleton`, `WebuiSkeletonGroup`, `FeedbackSkeleton` | `src/client/ui/page.tsx`, `src/client/ui/feedback.tsx` |
| A hover, press, enter, exit, expand or progress effect | `WebuiMotion`, `WebuiMotionSlot`, `WebuiDisclosure`, `WebuiTooltip` | `src/client/ui/page.tsx`, `styles/motion.css` |
| An empty, error, busy, progress, announced or pending state | `FeedbackEmpty`, `FeedbackError`, `FeedbackBusy`, `FeedbackProgress`, `FeedbackAnnouncement`, `FeedbackLiveRegion`, `FeedbackLoadingOverlay`, `useFeedbackActionLoading` | `src/client/ui/feedback.tsx`, `styles/feedback.css` |
| A Lottie animation | `WebuiLottie` — the only component that may drive the engine | `src/client/ui/feedback.tsx` |
| Direction, alignment, distribution or a named spacing step | `WebuiInline`, `WebuiStack` | `src/client/ui/layout-primitives.tsx`, `styles/layout.css` |
| A settings page frame, section, card, row, divider or hint | `SettingsPage`, `SettingsSection`, `SettingsCard`, `SettingsRow`, `SettingsDivider`, `InfoHint` | `src/client/ui/settings-layout.tsx` |
| A settings action button or settings dialog | `SettingsButton`, `SettingsSavedNotice`, `SettingsDialog` | `features/settings/ui/settings-atoms.tsx` — settings-owned, not a shared API |
| A 28px inline icon action inside a dense row | `IconButton` from `form-atoms`, with a Tabler icon as its child | `src/client/ui/form-atoms.tsx` |
| A dialog that belongs to a business form | `WebuiDialog` with the business's fields and `WebuiDialogActions` in the shared footer slot | `src/client/ui/dialog.tsx` |

When no row fits, the shape is either a business composition of these contracts or a genuinely new shared contract — see "When the shared layer is not enough".

## Prohibited in business code

Each row below moves one shared contract into one caller. Some are caught by a gate; the rest are caught by review, so "the gate is green" is not permission.

| Do not | Why it is a defect | Use instead |
| --- | --- | --- |
| Name a shared class string in a `.tsx` outside `client/ui/` (`webui-mavis-button*`, `webui-icon-button*`, `webui-feedback*`, `webui-field*`, `webui-form*`, `webui-menu-item*`, `webui-menu-separator*`, `webui-motion*`) | A class carries no variant, no size default, no `type="button"` and no accessible name; the caller re-derives a recipe the contract owns | Render the component |
| Re-declare a shared control's states in a feature stylesheet | Two owners for one control's appearance | Report the missing variant; the contract adds it |
| Write a local `transition`, `animation`, `@keyframes`, inline motion style, `animate-*` / `duration-*` / `ease-*` utility, interaction transform, static rotation or `scroll-behavior: smooth` | Timing becomes a per-caller number, and the reduced-motion policy stops reaching it | `WebuiMotion` / `WebuiMotionSlot` / `WebuiDisclosure`; `bindings/browser-effects.ts` for programmatic scrolling |
| Hand-roll `role="button"` on a `div` or `span` | Bypasses shared button semantics and the feedback family | `WebuiButton` |
| Hand-roll a dialog or popup, or add a floating layer without inventorying it | Dismissal, focus return and stacking stay with one surface while the coordinator owns the rest | `WebuiDialog` / `WebuiDropdown`, then classify the layer in `scripts/lib/webui-overlay-inventory.json` |
| Author `role="alert"`, `role="status"`, `role="log"`, `role="progressbar"` or `aria-live` yourself | The client keeps an announcement budget per file; a hand-written region is drift the ratchet reports | The feedback family |
| Write pulse keyframes, a shimmer or a size-specific skeleton animation | Every loading surface shares one solid-colour pulse and one reduced-motion policy | `WebuiSkeleton` / `FeedbackSkeleton` |
| Draw an interface glyph as inline SVG paths, CSS shapes, pseudo-elements or text characters (`→`, `✓`, `+`, `×`) | A second icon vocabulary | Tabler glyphs through the shared wrappers |
| Read `document` or `window` in a `client/ui/` or feature-`ui/` module | The dependency gate bans ambient browser capability in a binding | Platform capabilities (`useWebuiBrowserCapabilities().dom`) or a binding in `bindings/` |
| Native `<details>` for a disclosure, or inline SVG `<animate*>` / the Web Animations API | A second disclosure and animation implementation | `WebuiDisclosure`, `WebuiMotion` |
| Disable a control by hand while its command runs, or draw a local spinner | Pending state is the control's; two flags disagree the moment one path forgets | `loading` / `loadingLabel`, or a promise-returning `onClick` |
| Replace a raw-element selector with a shared class string in business CSS so the ratchet passes | The ratchet becomes passable without adopting anything | Adopt the component; renaming is a separate, recorded job |
| Add a one-off palette, font, gradient, shadow or radius system | The token surface is the design system | Semantic tokens and the existing scales |

## When the shared layer is not enough

A difference only one caller has is that caller's layout. Decide it in this order:

1. **Layout** — width, margin, placement, internal arrangement, truncation, a grid: the caller's, through utilities or its own composition.
2. **A recurring appearance difference** — two or more callers with the same need becomes a **named variant or size on the shared contract**, added in `src/client/ui/` and documented in `packages/webui/docs/design/design-language.md`. A caller never keeps a private copy of the recipe while the contract grows a variant.
3. **A one-off the shared layer genuinely cannot express** — a `business-exception` entry in `scripts/lib/webui-presentation-inventory.json` with its reason and its revisit condition, plus a comment at the call site.
4. **A new floating layer** — an entry in `scripts/lib/webui-overlay-inventory.json`: `managed` when it registers with `client/ui/overlay-coordinator.tsx`, `borrows-role` when it only uses `role="dialog"` for labelling, `exception` with its interaction boundary stated when it cannot join.
5. **A new effect** — a `distinct` entry with its reason in `packages/webui/docs/design/motion-inventory.json`. Approval for a feature-owned effect comes from a decision record, not from the gate.

A new module under `client/ui/`, `shell/` or `features/*/ui/` also needs its classification before `pnpm check:webui-presentation` passes; `packages/webui/AGENTS.md` states the obligation.

## Design direction

Use restrained neutral surfaces, quiet separators, compact readable text, rounded controls and sparse blue accents. Communicate hierarchy through surface, spacing and text roles. Primary actions use the existing neutral high-contrast treatment; links, selected indicators and switches use accent where their existing recipe does. Adding a component is not an invitation to add a new palette, font, gradient, shadow or icon family. Use the existing Tabler icon library for interface glyphs; do not draw new icons yourself.

For a style modification, retain the component's established size and interaction contract unless the request changes it. For a new composition, assemble the contracts above and keep only the genuinely business-specific part local. The contracts are the design reference; full-page screenshots are optional context.

## Select colors by purpose

Use semantic tokens in component styles. Primitive ramps such as `gray_500` and `blue_400` define the palette underneath themes; do not use them instead of semantic roles simply because a sampled color looks right. Let `.light`/`.dark` rebind semantics rather than adding per-component theme colors.

| Purpose | CSS token | Tailwind example |
| --- | --- | --- |
| Main canvas/input fill | `--bg_default_primary` | `bg-bg_default_primary` |
| Secondary surface | `--bg_default_secondary` | `bg-bg_default_secondary` |
| Grouped card/surface | `--bg_grouped_secondary` or `--bg_grouped_tertiary` | `bg-bg_grouped_secondary` |
| Floating elevated surface | `--bg_grouped_secondary_elevated` | `bg-bg_grouped_secondary_elevated` |
| Main title/body | `--text_default_primary` | `text-text_default_primary` |
| Description/support text | `--text_default_secondary` | `text-text_default_secondary` |
| Lower emphasis metadata | `--text_default_tertiary` | `text-text_default_tertiary` |
| Accent link/indicator | `--text_default_accent`, `--icon_default_accent` | `text-text_default_accent` |
| Primary/secondary icon | `--icon_default_primary`, `--icon_default_secondary` | `text-icon_default_secondary` |
| Ordinary/subtle separator | `--border_default`, `--border_light` | `border-border_default` |
| Focus/selected outline | `--border_accent` | `border-border_accent` |
| Neutral primary action | `--bg_interaction_primary_default` + `--text_label_primary_default` | `bg-bg_interaction_primary_default text-text_label_primary_default` |
| Secondary action | `--bg_interaction_secondary_default` + `--text_default_primary` | `bg-bg_interaction_secondary_default` |
| Quiet hover/press/selection | `--bg_interaction_tertiary_hover`, `_press`, `_selected` | `hover:bg-bg_interaction_tertiary_hover` |
| Destructive text action | `--text_label_danger_secondary_default` | `text-text_label_danger_secondary_default` |
| Destructive filled action | `--bg_interaction_danger_primary_default` + `--text_label_danger_primary_default` | Match its `_hover`/`_press`/`_inactive` family |
| Error/warning/success surface | `--bg_status_error`, `--bg_status_warning`, `--bg_status_positive` | Pair with corresponding semantic text/icon/border, not color alone |

Choose a background/foreground pair together. Inverted/static text is for the matching contrast surface, not ordinary card labels. Use the same semantic family's state variants; do not darken a hex value manually for hover. Existing `--webui-color-*` aliases and hardcoded legacy declarations are not a second design system to extend.

## Typography and geometry

| Concern | Available scale / preferred starting point |
| --- | --- |
| Fonts | `font-sans` for UI; `font-mono` for code/terminal. Existing HarmonyOS/system/CJK and Hack/system fallbacks remain authoritative |
| Body | `text-body-base`: 14px / 22px; compact form/menu labels often use `--size_14` / `--line_height_20` |
| Caption | `text-caption-base`: 12px / 18px; metadata uses secondary/tertiary text roles |
| Other size tokens | `--size_12/14/16/20/24/32/40/48/64`; use large sizes for actual headings/hero content, not ordinary controls |
| Spacing tokens | `--spacing_0/2/4/6/8/12/16/20/24/32/40/48/64/90/128` |
| Spacing use | 4–8px within an icon/label group; 8–12px between related controls; 12–16px component padding; 20–32px between sections are recommended starting points, adjusted to the existing surface recipe |
| Radius tokens | `--radius_4/8/12/16/20/24/32/full` |
| Radius use | 8px compact controls/inputs; 12px menus/small surfaces; 16–20px larger cards/composer; full for pills/circles. Preserve a reused component's exact recipe |
| Weight | Use existing `font-normal`/`font-medium` utilities (400/500). Baseline `--weight_regular`/`--weight_medium` values contain `px`; do not copy that unit into new `font-weight` rules |
| Icons | Tabler React components from `@tabler/icons-react`; typically 16px inside compact controls. Reuse a matching `WebuiIcon*` wrapper from `src/client/shell/icons.tsx` when available; otherwise import the Tabler glyph directly and size it to the component recipe |

### Interface icons

- Use `@tabler/icons-react`, already included by `packages/webui`. Prefer an existing semantic wrapper from `src/client/shell/icons.tsx` when one matches; otherwise import the appropriate named `Icon*` component directly.
- Do not hand-draw interface glyphs as inline SVG paths, CSS shapes/pseudo-elements, or text characters such as arrows, checks, plus signs and crosses. Replace such glyphs with Tabler components and retain the surrounding accessible name, layout and interaction.
- Keep approved brand marks as their supplied assets. Purpose-built illustrations, data visualizations, progress geometry and animations are not interface glyphs; keep their domain-specific rendering when needed instead of forcing them into an icon component.

Prefer `gap-spacing_8`, `p-spacing_12`, `rounded-radius_8`, `text-body-base` and semantic colors. Stock classes such as `gap-2` and `size-7` are supported too; preserve them in existing recipes. Literal geometry is appropriate when the scale does not describe the required shape. A shared component's published size is the geometry: do not restate or override it.

## What each contract owns

| Contract | The contract owns | The caller states |
| --- | --- | --- |
| `WebuiButton` / `WebuiIconButton` / `WebuiButtonLink` | 21 named variants (filled, destructive, quiet, ringed, segmented, selectable row, accent, grouped, send action), 18 named sizes, the content row (inline-flex, centred, 8px icon/label gap, `contentGap` to change it), focus, disabled and pending states, and the shared dialog action geometry | variant, size, label, its own layout (width, margin, placement), the command, and `loading`/`loadingLabel` where the command can be waited on |
| `WebuiIconButton` | icon-only sizes: `regular` 26px, `compact` 24px, `micro` 16px (glyph inside a chip or row), `rail` 30px, `panel` 36px; the accessible name comes from `label` | `label`, tone, size, glyph |
| `ToggleSwitch` | 40×20 track, sliding thumb, `role="switch"`, `aria-checked`, accent checked state, visible focus, and the pending state | `checked`, `label`, `onChange` (may return a promise), `disabled` |
| `WebuiField` and the native controls | the label, description and error wiring (`for`, `aria-describedby`, `aria-invalid`), input appearance and focus, textarea multiline behaviour, hidden file-picker geometry, `WebuiSearchField`'s icon/input/focus-within composition, form layout and action arrangement | submission, validation rules, business state, and the control's own content |
| `WebuiDialog` | the shell: `compact`/`standard`/`wide` width, 85vh maximum height, 16px radius, independently scrolling body, fixed title row and footer, the scrim token, portal placement, coordinator registration, inert background, focus containment and return, the exit motion, and `role="alertdialog"` when asked for | `open` (always explicit), `title`, `description`, `footer` or `WebuiDialogActions`, `onClose`, `portalTarget` from the platform capability, validation and business commands |
| `WebuiDropdown` / `WebuiFlyoutSurface` | the surface, viewport-coordinate placement, dismissal at `pointerdown` plus Escape with focus return to the trigger, the exit lifetime, and coordinator membership when `managed` | open state, `side`/`align`/`width`/`collision`/`offset`, `role`, content classes, and `managed` plus a layer id for a new surface |
| `WebuiMenuItem` / `WebuiMenuSeparator` | a `role="menuitem"` row's label, icon slot, trailing slot and disabled state | the row's content and command |
| `WebuiContextMenu` | placement and dismissal semantics and the menu surface | items, position, command |
| `WebuiCard` | fill, hairline border, 16px radius and soft shadow | layout, and its own radius or fill when it genuinely differs |
| `WebuiPage` | page presence and exit (`present`, `visible`, `onExitComplete`), the `kind`, and the loading state with its skeleton projection and one status label | DOM structure, content, geometry, business state and lifetime |
| `WebuiMotion` / `WebuiMotionSlot` / `WebuiDisclosure` / `WebuiTooltip` | every duration, easing, direction and reduced-motion behaviour, plus a disclosure's clipping and hidden state and a tooltip's opacity/visibility/offset states | the family, the state, the direction, the rotation value of a disclosure indicator, and the target geometry |
| `Feedback*` family | every announcement channel, the empty/error/busy/progress/skeleton layouts, the pending overlay, and the skeleton pulse | the words, the retry command, the amount, the rows and geometry options |
| `SettingsPage` and its atoms | the 704px centred settings column, the section title, the grouped card, the row, the inset divider and the hint | the page's content and controls |

A caller that finds itself restating anything in the middle column is writing the contract a second time.

## State contract for interactive controls

| State | Required treatment |
| --- | --- |
| Default | Semantic foreground/background pair, legible label, stable geometry |
| Hover / press | The component's own semantic state tokens; keep dimensions stable |
| Keyboard focus | The shared `--border_accent` treatment (a 2px outline with 1–2px offset, or the component's inset ring) |
| Selected / checked | Visible indicator plus `aria-pressed`, `aria-selected` or `aria-checked`; selected is not hover |
| Disabled / unavailable | Native disabled semantics, muted treatment, no active hover; explain an unavailable capability when the reader needs the reason |
| Pending | `loading` on the control: disabled plus `aria-busy` plus the shared overlay; label and layout stay, and a second start is impossible |
| Loading (data) | The shared skeleton projection or `FeedbackSkeleton` with one status label; skeleton shapes are decoration |
| Error | The feedback family's error layout, a readable message and the existing recovery command; the input is preserved |

Check long labels, shrink/overflow behaviour, keyboard navigation, overlay placement and both themes in the actual component; the state table states obligations, not a substitute for the rendered check.

## Minimal business composition

A business surface composes the contracts and keeps only its own layout. This example is a composition — not a new control — and its class carries placement only.

```tsx
import { WebuiButton } from "../../../ui/button.js";
import { WebuiCard } from "../../../ui/card.js";
import { WebuiField, WebuiTextInput } from "../../../ui/field.js";
import { FeedbackError } from "../../../ui/feedback.js";
import { WebuiStack } from "../../../ui/layout-primitives.js";

export function ExamplePanel({ name, error, saving, onName, onSave }: {...}): ReactElement {
  return (
    <WebuiCard className="webui-example-panel">
      <WebuiStack gap="compact">
        <WebuiField label="名称" description="显示在列表里">
          <WebuiTextInput value={name} onChange={onName} />
        </WebuiField>
        {error ? <FeedbackError message={error} /> : null}
        <WebuiButton variant="primary" size="regular" loading={saving} loadingLabel="正在保存…" onClick={onSave}>
          保存
        </WebuiButton>
      </WebuiStack>
    </WebuiCard>
  );
}
```

```css
@layer components {
  /* Placement only: the card, the field, the stack and the button own their appearance. */
  .webui-example-panel {
    display: flex;
    width: 100%;
    max-width: 420px;
    padding: var(--spacing_16);
  }
}
```

Place the CSS in `src/client/features/<business>/ui/<business>.css`, imported through `styles/index.css`; do not add another stylesheet link. If the class starts describing a control's fill, border, radius or states, the thing being written is a control — and a control belongs in `client/ui/`.

## Completion check

Before delivering a component, be able to name: the shared contract it renders (or the recorded exception that says why not), the semantic foreground/background/state tokens, the type/spacing/radius choices, the stylesheet owner, and the motion family it uses. Then run the gates that cover the change — `pnpm check:webui-presentation`, `pnpm check:webui-motion`, `pnpm check:webui-overlays` and `pnpm check:webui-feedback` for presentation work, plus `pnpm check:webui-dependency` when a module or import moved — build to confirm the classes are emitted, and inspect the real result in both themes and the relevant interaction states. A green gate is not a rendered check; use `visual-design.md` for compiler, cascade, asset and browser-verification details.
