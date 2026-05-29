# EAS — Binderly mobile (iOS + Android)

Production build + store-submit config for `apps/mobile` (the Expo / React
Native app) via [Expo Application Services (EAS)](https://expo.dev). Per
`PROJECT.md` § 4, the mobile app ships to the App Store / Play Store through
EAS Build + Submit.

This is **scaffolding** (Stage 11 / T-DP-EAS). It ships the build profiles +
deploy workflow; the live build/submit is **inert** until Pablo provisions an
Expo account + `EXPO_TOKEN` (and, for store submission, the per-store
credentials). Nothing here runs against a real account until then.

The build config itself lives next to the app at **`apps/mobile/eas.json`**
(EAS resolves it relative to the project root, not this `infra/` dir). This
file is just the human runbook + the credential map.

---

## Profiles (`apps/mobile/eas.json`)

| Profile       | Distribution | Channel       | Notes                                                                 |
| ------------- | ------------ | ------------- | --------------------------------------------------------------------- |
| `development` | internal     | `development` | Dev client build; iOS simulator on, Android APK. For local dev loops. |
| `preview`     | internal     | `preview`     | Ad-hoc / internal QA install (APK), no store submit.                  |
| `production`  | store        | `production`  | Store-ready; Android **app-bundle**, auto-increments build numbers.   |

`cli.appVersionSource` is **`remote`**: EAS owns the iOS `buildNumber` /
Android `versionCode`, and the `production` profile sets `autoIncrement: true`,
so CI never mutates `app.json`. The user-facing `version` string still comes
from `apps/mobile/app.json` (`expo.version`, currently `0.0.1`) — bump that for
a marketing-version change.

Bundle id / package are already set in `app.json`:
`app.binderly.binderly` (both platforms).

---

## Tooling expectations

- **Expo SDK 52** (`expo@52.x` is pinned in `apps/mobile/package.json`).
- **EAS CLI** — `eas.json` requires `>= 12.0.0`. Don't add `eas-cli` to the
  workspace; install it ad-hoc (`npm i -g eas-cli` locally; the CI workflow
  uses `expo/expo-github-action` with `eas-version: latest`).
- The repo pins **Node 22.13.0** (`.nvmrc`) + **pnpm 9.15.9** (Corepack).

---

## First-run setup (Pablo, once)

```bash
# 0. Authenticate the CLI locally (one time).
npm i -g eas-cli
eas login

# 1. Link the Expo project. This writes extra.eas.projectId into the app
#    config (commit that change). Run from the app dir so EAS finds eas.json.
cd apps/mobile
eas init

# 2. Generate / upload signing credentials. EAS stores these server-side —
#    they are NEVER committed and NEVER put in GitHub secrets.
eas build:configure           # picks platforms, sets up credentials
eas credentials               # inspect / upload iOS cert+profile, Android keystore

# 3. Mint a CI access token and add it to GitHub as EXPO_TOKEN.
#    expo.dev → Account → Settings → Access tokens → Create
#      → GitHub repo → Settings → Secrets and variables → Actions → New secret
#        name: EXPO_TOKEN

# 4. First build (manual). Pick a profile; production is store-ready.
eas build --profile preview --platform all        # internal QA first
eas build --profile production --platform all      # store build
```

After `EXPO_TOKEN` is in GitHub, the same builds can run from CI via the
**Deploy / Mobile (EAS)** workflow (`.github/workflows/deploy-mobile.yml`) →
*Run workflow* → choose profile / platform / submit. The workflow is
**manual-dispatch only** (native builds consume EAS build minutes — we don't
auto-build on every push).

---

## Store submission

Store submit is **opt-in** (the workflow's `submit` input, production only) so
a build never auto-pushes to a store unexpectedly. It needs the per-store
credentials documented in `infra/DEPLOYMENT_SECRETS.md` § 5:

- **iOS** → App Store Connect API key (`.p8`): `ASC_API_KEY_P8` +
  `ASC_API_KEY_ID` + `ASC_API_KEY_ISSUER_ID`. CI writes the `.p8` to a temp
  file and exports `ASC_API_KEY_PATH` (referenced by `eas.json`).
- **Android** → Google Play service-account JSON:
  `GOOGLE_SERVICE_ACCOUNT_KEY_JSON`. CI writes it to a temp file and exports
  `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`. Submits to the **internal** track first.

Locally you can also submit interactively (EAS prompts for / reuses stored
credentials):

```bash
cd apps/mobile
eas submit --profile production --platform ios
eas submit --profile production --platform android
```

---

## Update channels (EAS Update — future)

The profiles declare `channel`s (`development` / `preview` / `production`) so
OTA updates via `eas update` can be wired later (e.g. monitoring / hotfix
follow-up) without changing the build config. No `expo-updates` runtime is
wired in the app yet — that's a separate follow-up.

---

## Go-live gating

A live mobile release is gated on Pablo providing the Expo account +
`EXPO_TOKEN` (build) and the Apple ASC API key + Google Play service account
(submit). This ties into the Stage 11 go-live follow-up (#FU-53) in
`status.md`.
