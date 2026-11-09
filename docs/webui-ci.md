# WebUI-only GitHub CI

The public `mcode-webui/minimax-code` repository uses
`.github/workflows/webui-ci.yml` for pull requests, pushes to `main`, and manual
runs. It executes existing WebUI commands directly. It does not invoke the
repository-wide `pnpm verify` pipeline or publish packages.

| Coverage | Linux / Node 24 | macOS / Node 24 |
| --- | --- | --- |
| WebUI server, client and test types | Yes | Yes |
| Dependency, presentation, motion, overlay and feedback rules | Yes | Yes |
| WebUI build and bundle boundaries | Yes | Yes |
| WebUI unit and integration tests | Yes | Yes |
| Playwright browser scenarios | Yes | No |
| npm package build, installation and launcher verification | Yes | Yes |

Package verification uses an isolated installation and does not publish to npm.
Browser failure diagnostics are retained as Actions artifacts for seven days.

## Repository settings

The following inherited workflows are disabled in the public repository's Actions
settings: Source verification, CLI release, Node compatibility, Performance,
Release audit, Source candidate, Label issue product, Sync GitHub issues to
Feishu, and WebUI npm preview. Their files remain in Git for recovery and for
the existing local workflow-contract tests. In particular, npm publishing is
disabled, including manual runs of the preview workflow.

GitHub workflow disablement is repository configuration, not a YAML change.
Copying the repository to another GitHub repository does not copy that setting;
configure the active workflows there before pushing or publishing tags.
Dependabot can still create dependency-update PRs; those PRs run WebUI CI.

The local `pnpm verify`, its profiles, all existing gate scripts and package
commands are unchanged. Run them locally when broader runtime, CLI, release or
security validation is needed. A green WebUI CI run does not establish those
broader checks. The previously reported repository-history scan findings are
outside this CI scope and have not been remediated by disabling Release audit.

Automatic CI does not impose merge protection. Required checks and branch rules
remain a separate repository setting.
