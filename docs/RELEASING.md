# Releasing Vivi

This document describes the actual release process, for whoever is cutting a release
(currently the maintainer). It describes `.github/workflows/ci.yml` and
`.github/workflows/build.yml` as they exist today — read those files if this drifts.

## How CI gates a release

`ci.yml` runs on every push (any branch) and every pull request: `npm run lint`, `npm run
typecheck`, `npm test`, `npm run build`, an Electron smoke-test pass under `xvfb-run`
(`tests/e2e/smoke.spec.ts`), and a Linux `electron-builder --dir` package that's checked with
`scripts/verify-dist.mjs` (native modules and the bundled Claude binary present).

Importantly, **`build.yml` (the release workflow) does not itself depend on `ci.yml` passing** —
there's no `workflow_run` gate between them. The gate is manual: don't tag or trigger a release
dispatch on a commit whose `ci.yml` run isn't green. In practice, tag from `main` right after CI
has passed on the commit you're releasing.

## Versioning

Bump the version with npm's built-in tooling, which updates `package.json` (and
`package-lock.json`) and creates a commit + local tag:

```bash
npm version patch   # or: minor / major
```

Vivi is pre-1.0 and follows the `0.1.x` stabilization plan in `docs/ROADMAP.md`, so most releases
until 1.0 will be `patch` or `minor` bumps.

## Triggering a release

`build.yml`'s `release` job creates the GitHub Release, and only runs when either is true:

1. **A tag push matching `v*`.** Push the commit from `npm version`, then push the tag:

   ```bash
   git push
   git push --tags
   ```

   The job checks that the pushed tag name matches `v<version from package.json>` at that commit
   and fails loudly if they disagree (protects against tagging the wrong commit).

2. **A manual `workflow_dispatch` with `publish: true`.** From the Actions tab, run "Build
   installers" on the target branch/commit with the `publish` input checked. The job computes the
   tag from `package.json`'s current version and creates the release at `$GITHUB_SHA` if a release
   for that tag doesn't already exist.

Both paths exist because a tag push isn't always practical from every environment (for example, a
sandboxed development container whose git proxy doesn't allow pushing tags) — `workflow_dispatch`
with `publish: true` is the fallback for cutting a release from such an environment; a normal tag
push is the default path otherwise.

Either way, the `release` job uses `gh release create ... --notes-file .github/release-notes.md`
and titles the release `Vivi <version>`.

## How installers get built and uploaded

Once the `release` job has created (or confirmed) the GitHub Release, the `build` job runs as a
matrix over `ubuntu-latest` / `windows-latest` / `macos-latest`. Each runner:

1. Checks out, sets up Node (`node-version: 22`), runs `npm ci` and `npm run build`.
2. Optionally configures code signing from repository secrets, if present:
   - Windows: `CSC_LINK` / `CSC_KEY_PASSWORD`.
   - macOS notarization: `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` (hardened
     runtime and entitlements are already configured in `electron-builder.yml`).
   - When these secrets aren't set, `CSC_IDENTITY_AUTO_DISCOVERY` stays `false` and the build is
     unsigned (Windows SmartScreen / macOS Gatekeeper will warn on first launch — this is called
     out in `.github/release-notes.md`).
3. Runs `npx electron-builder <--linux|--win|--mac> --publish always` (only `always` when the
   `release` job succeeded; otherwise `--publish never`, e.g. on a run where release creation was
   skipped). `--publish always` is what uploads the built installers and update manifests
   (`latest*.yml`) directly into the GitHub Release electron-builder finds by tag.
4. Also uploads the same artifacts to the workflow run itself (`actions/upload-artifact`), so they
   are downloadable from the Actions run even if you want to inspect them before pointing anyone at
   the release.

Re-running the `build` job against a release created more than two hours ago is handled via
`EP_GH_IGNORE_TIME: 'true'`, which tells electron-builder's publisher not to reject the (older)
release as a target.

## `.github/release-notes.md`

The release's notes come from a **single static file**, `.github/release-notes.md`, reused as-is
for every release regardless of version. It's a fixed bilingual (RU/EN) description of what Vivi
does, not a per-version changelog. This is a known limitation — per-version, ideally
auto-generated release notes are tracked as roadmap epic **DIST-03** (`docs/ROADMAP.md`). Until
that's implemented, update `.github/release-notes.md` by hand if the feature summary it gives has
drifted from what's actually shipped, and update `CHANGELOG.md` separately with the specific
per-version entries (move `[Unreleased]` into a new version section there as part of the release).

## Manual verification checklist

Before tagging, run the automated checks locally as a first pass:

```bash
npm run lint && npm run typecheck && npm test
npm run build
```

Automated coverage (unit + mocked e2e) is necessarily incomplete for a desktop app that drives the
mouse/keyboard, speaks, and asks for OS permissions — the manual, per-OS checklists in
[`docs/ROADMAP.md` section 6.3](ROADMAP.md#63-ручные-чек-листы-перед-релизом) (Windows 11, macOS
14/15, Ubuntu 24.04 X11/Wayland, plus the cross-platform checks) are the actual pre-release gate
for those flows and are **not duplicated here** — run them from that document so there's a single
source of truth as it evolves.

## After the release

- Confirm all three platform installers and `latest*.yml` manifests attached to the GitHub Release.
- Update `CHANGELOG.md` if it wasn't already updated as part of the release PR.
- If the manual checklists surfaced defects, file them before moving on rather than carrying them
  silently into the next release.
