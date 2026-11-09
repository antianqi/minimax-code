# Plugin action inventory — the 29 actions behind the plugin port

The `plugins` business is sized by its **actions**, not by its port member count: the port declares two
members, of which `pluginManagement` stands in front of 29 union values. This file is the authority
for that population — `test/unit/plugin-action-inventory.test.ts` reads it and compares the action
names as a set against the code carriers, so a name added or changed in one carrier without this file
fails the suite.

## Counting rule

| field | value |
| --- | --- |
| population | `WebuiPluginManagementAction`, `packages/webui/src/shared/plugin-management.ts` |
| unit | one union value = one action |
| method | read the union's members; cross-check the other carriers of the same set |

Four carriers hold the same 29 names, and the suite compares all of them against this list: the
shared union, the server's accepted-action set (`server/operation/plugin-management.ts`), the server's
input-shape map (`INPUT_SHAPES` in the same file), and the typed adapter
(`client/features/plugins/contracts/plugin-actions.ts`).

**The port's member count is a different unit and is not the size of this business.** `plugin-port.ts`
declares `pluginManagement?` and `listSkills?`: two members, 29 actions.

## The inventory

`surface` is the area of the plugin-management page that reaches the action — the five tabs
`plugins` | `skills` | `apps` | `mcp` | `agents`. Every action is dispatched from the business's owner
module, `client/features/plugins/application/plugin-workflows.ts` (`call` for reads, `mutate` for
writes); the component column names the presentation that invokes it.

### Surface `plugins` — the catalogue and its lifecycle (8)

The official marketplace reads all plugin pages and groups the returned plugin tags using
the server's tag definitions. A tag such as Mini App is both a section and a filter;
installation still goes through the plugin action below. The cloud filters its catalogue by the
version a client declares, so WebUI declares one: the shared constant
`MARKETPLACE_VISIBILITY_DESKTOP_VERSION` (`packages/shared/src/marketplace-visibility.ts`). The marketplace requests —
listing, detail, installation, package download authorization and official state recovery —
declare it, and the other cloud calls retain the host's own version.
The runtime carries that declaration; it never decides the value.
This allows discovery of version-gated entries but does not establish that every listed
plugin works in WebUI.

| # | action | caller | owner |
| ---: | --- | --- | --- |
| 1 | `listMarketplacePlugins` | owner (market and personal lists) | `plugins` |
| 2 | `listInstalledPlugins` | owner; also `application/composer-catalogue.ts` for the composer's `@` menu | `plugins` |
| 3 | `previewGithubPlugin` | owner | `plugins` |
| 4 | `importGithubPlugin` | owner; `ui/PluginImportDialog.tsx` | `plugins` |
| 5 | `installPlugin` | owner; `ui/PluginMarketplace.tsx`, `ui/PluginManagementList.tsx` | `plugins` |
| 6 | `uninstallPlugin` | owner; `ui/PluginManagementList.tsx` | `plugins` |
| 7 | `enablePlugin` | owner; `ui/PluginMarketplace.tsx`, `ui/PluginManagementList.tsx` | `plugins` |
| 8 | `disablePlugin` | owner; `ui/PluginMarketplace.tsx`, `ui/PluginManagementList.tsx` | `plugins` |

### Surface `skills` — the skill catalogue (7)

| # | action | caller | owner |
| ---: | --- | --- | --- |
| 9 | `listManageableSkills` | owner | `plugins` |
| 10 | `listSkillHub` | owner | `plugins` |
| 11 | `setSkillEnabled` | owner; `ui/PluginManagementList.tsx` | `plugins` |
| 12 | `deleteSkill` | owner; `ui/PluginManagementList.tsx` | `plugins` |
| 13 | `installSkill` | owner; `ui/PluginMarketplace.tsx` | `plugins` |
| 14 | `createSkill` | owner; `ui/SkillForm.tsx` | `plugins` |
| 15 | `listRuntimeSkills` | composer catalogue; `features/plugins/application/composer-catalogue.ts` | `plugins` |

The personal skill list is read through `listManageableSkills` on purpose: the runtime skill list
excludes disabled entries, and the management list must include them so one can be turned back on.

The composer's roster is read through `listRuntimeSkills`, which is a different list: it is what
the agent can run, and it carries the plugin skills and the workspace's own skills. The read names the
session, not an agent: the runtime resolves the session's agent from the session itself, and an agent
name it does not know (the shell's placeholder for "no session" is one) makes the runtime answer with an
empty roster.

### Surface `apps` — the mini-app catalogue (1)

| # | action | caller | owner |
| ---: | --- | --- | --- |
| 16 | `listApps` | owner | `plugins` |

### Surface `mcp` — MCP servers (7)

| # | action | caller | owner |
| ---: | --- | --- | --- |
| 17 | `listMcpServers` | owner | `plugins` |
| 18 | `getMcpServer` | owner | `plugins` |
| 19 | `createMcpServer` | owner; `ui/McpServerForm.tsx` | `plugins` |
| 20 | `updateMcpServer` | owner; `ui/McpServerForm.tsx` | `plugins` |
| 21 | `deleteMcpServer` | owner; `ui/PluginManagementList.tsx` | `plugins` |
| 22 | `setMcpServerEnabled` | owner; `ui/McpServerForm.tsx`, `ui/PluginManagementList.tsx` | `plugins` |
| 23 | `testMcpServer` | owner | `plugins` |

### Surface `agents` — agent administration (6)

| # | action | caller | owner |
| ---: | --- | --- | --- |
| 24 | `listAgents` | owner | `plugins` — a capability, not a business |
| 25 | `readAgentAvatar` | owner (list rows and the reader) | `plugins` — capability |
| 26 | `getAgent` | owner | `plugins` — capability |
| 27 | `createAgent` | owner; `ui/AgentForm.tsx` | `plugins` |
| 28 | `updateAgent` | owner; `ui/AgentForm.tsx` | `plugins` |
| 29 | `deleteAgent` | owner; `ui/PluginCatalogue.tsx` | `plugins` — capability |

**All 29 actions belong to `plugins`.** Every one has a client caller.

## Two facts worth keeping

**`listRuntimeSkills` is the composer's roster read, and it is not the management list.** The
runtime keeps two skill lists: the roster (`listRuntimeSkills`), which is what a turn can load and
which carries the plugin skills and the workspace's own skills, and the management catalogue
(`listManageableSkills`), which is paged, user-facing, and stops at the first page. The composer's
slash palette shows the roster — reading the management catalogue
there offered a fraction of the skills, and none of the plugin ones.

The action is dispatched by the composer-facing read model
(`features/plugins/application/composer-catalogue.ts`) rather than by the owner module, so the
suite asserts that it is the one action the owner does not dispatch and that the catalogue does.

**Agent administration is a capability inside `plugins`, not a thirteenth business.** The six
`agents` actions are one tab of the same page, reached from one rail row, held by the same owner
module and rendered by the same page component. It is recorded here so the population is not divided
by a member count that does not exist. The two alternative homes were considered and are worse:
`settings` owns memory *as a setting of the running agent*, not an agent catalogue, and a session
created from an agent row is `sessions`' command being invoked by this page, not a duty of the page.
