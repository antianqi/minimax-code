# WebUI-only GitHub CI

The public `mcode-webui/minimax-code` repository uses
`.github/workflows/webui-ci.yml` for pull requests, pushes to `main`, and manual
runs. It executes existing WebUI commands directly. It does not invoke the
repository-wide `pnpm verify` pipeline or publish packages.

| Coverage | Linux / Node 24 | macOS / Node 24 | Windows / Node 24 |
| --- | --- | --- | --- |
| WebUI server, client and test types | Yes | Yes | Yes |
| Dependency, presentation, motion, overlay and feedback rules | Yes | Yes | Yes |
| WebUI build and bundle boundaries | Yes | Yes | Yes |
| WebUI unit and integration tests | Yes | Yes | Yes |
| Playwright browser scenarios | Yes | Yes | Yes |
| npm package build, installation and launcher verification | Yes | Yes | Yes |

Package verification uses an isolated installation and does not publish to npm.
Browser diagnostics and raw performance samples are retained as Actions artifacts
for seven days on successful and failed runs. Samples are written to the output
directory explicitly so the list reporter cannot discard in-memory attachments.
After a successful build and Chromium installation, browser checks still run if
unit tests fail. Package verification also runs after a successful build even if
an earlier test suite failed. Each failure still makes the job fail; this keeps
independent failures visible in one run instead of masking later suites.
Linux additionally installs Chromium system dependencies. Every platform runs
the browser and package suites. This coverage declaration
does not establish a passing run; platform and visual-baseline failures remain
visible and require diagnosis rather than relaxed assertions.

Hosted macOS sets `WEBUI_BROWSER_HEADED=1` for the browser suite and runs full
Chromium in a window. Native blank-page controls reproduced headless frame-source
stalls without the WebUI; windowed mode improves pacing but does not eliminate
hosted-runner pauses. Streaming frame p95 is compared with the same page's idle
samples before and after streaming, allowing at most 50 ms of additional application
overhead above idle p95. Raw frame gaps, timers and tasks are retained for investigation.
Application execution retains the absolute 50 ms budget: lightweight Chromium tracing
measures main-thread task CPU time, and Long Animation Frame script duration also
rejects JavaScript blocking (including synchronous waits). Raw LongTask wall durations
remain diagnostic because they can include hosted-runner descheduling. Missing timing
capabilities or required task CPU samples fail explicitly. Real idle, busy-script, forced-layout
and synchronous-wait
controls verify attribution in the browser suite. Other interaction budgets are unchanged.
Linux, Windows and local runs remain headless by default. To reproduce
the macOS CI browser mode locally, run `WEBUI_BROWSER_HEADED=1 pnpm test:webui-browser`
after building the client and installing Chromium.

## Active and archived workflows

Only `webui-ci.yml` remains in `.github/workflows/`. The following inherited
workflows are archived under `.github/legacy-workflows/`: Source verification,
CLI release, Node compatibility, Performance,
Release audit, Source candidate, Label issue product, Sync GitHub issues to
Feishu, and WebUI npm preview. GitHub does not discover workflows in that
directory. Their content is preserved for recovery and the existing local
workflow-contract tests. npm publishing has no active workflow entry point.

The legacy workflows also remain disabled in repository settings, but the
source archive is what makes this scope portable to a new checkout or repository.
Restoring a legacy YAML file to `.github/workflows/` would restore its triggers;
the workflow-contract test rejects additional active YAML files.
Dependabot can still create dependency-update PRs; those PRs run WebUI CI.

The CI scope does not remove steps from local `pnpm verify` profiles or retire
local package commands. Run them locally when broader runtime, CLI, release or
security validation is needed. A green WebUI CI run does not establish those
broader checks. The previously reported repository-history scan findings are
outside this CI scope and have not been remediated by disabling Release audit.

Automatic CI does not impose merge protection. Required checks and branch rules
remain a separate repository setting.
