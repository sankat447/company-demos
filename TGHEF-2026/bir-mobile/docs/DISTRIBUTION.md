# DISTRIBUTION.md — Building, Signing & Shipping the Bir Apps

How the binaries leave this repo: **Play Store AAB**, **App Store IPA**, and the
**direct-download APK with QR code** hosted on the existing AWS stack. Includes the CI/CD
pipeline, signing custody, and the release/rollback runbook Claude Code automates.

---

## 1. Channels at a glance

| Channel                                   | Artifact                  | Audience                                                          | Trust model                                                           |
| ----------------------------------------- | ------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| Google Play (production + internal track) | `.aab`                    | General public                                                    | Play signing, Play Integrity                                          |
| Direct download `get.bir.example`         | universal `.apk`          | Festival week onboarding, low-connectivity users, partner devices | Same upload key as Play; SHA-256 published; "unknown sources" install |
| Apple App Store + TestFlight              | `.ipa`                    | General public / beta                                             | Apple signing & review                                                |
| iOS ad-hoc OTA (QR)                       | `.ipa` + `manifest.plist` | **Registered test devices only** (≤100 UDIDs)                     | Ad-hoc provisioning                                                   |

> **Apple reality check (do not promise otherwise):** iOS has no public sideloading
> equivalent to the APK channel. The QR install for iOS works only for devices whose
> UDIDs are in the ad-hoc provisioning profile (team devices, gate kiosks, VIP demos) —
> or org-internal via Apple Business Manager. The public iOS path is App Store/TestFlight.

---

## 2. Build system — EAS profiles (`eas.json`)

```jsonc
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": {
      // ← the QR sideload channel
      "distribution": "internal",
      "android": { "buildType": "apk" }, // universal APK
      "ios": { "simulator": false }, // ad-hoc IPA (registered devices)
      "channel": "preview",
      "env": { "APP_CHANNEL": "direct" },
    },
    "production": {
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" }, // AAB for Play
      "ios": {}, // store IPA
      "channel": "production",
      "env": { "APP_CHANNEL": "store" },
    },
  },
  "submit": {
    "production": {
      "android": { "serviceAccountKeyPath": "eas-secret:PLAY_SA_JSON", "track": "internal" },
      "ios": { "ascApiKeyPath": "eas-secret:ASC_KEY", "appleTeamId": "…" },
    },
  },
}
```

Version policy: `version` = marketing (1.x.y), `versionCode`/`buildNumber` auto-increment
via EAS remote. OTA JS fixes ship over **EAS Update** on the matching channel; anything
touching native modules requires a new binary.

---

## 3. Direct-download channel on the existing AWS stack

Uses only contract resources: `storage.appDistBucket` behind `storage.appDistDomain`
(CloudFront + ACM cert + Route53 already in the backend project).

**Bucket layout**

```
s3://<appDistBucket>/
  android/
    bir-app-1.4.2-c1234abc.apk
    latest.json                 # {"version":"1.4.2","apk":"…apk","sha256":"…","minOs":"8.0","notes":{"en":…,"hi":…}}
  ios-adhoc/
    bir-app-1.4.2.ipa
    manifest-1.4.2.plist        # itms-services manifest (ad-hoc devices only)
  site/
    index.html                  # the download page (below)
    qr-android.png  qr-ios.png
```

**Publish step (`scripts/publish-direct.ts`, run by CI after a preview/production build):**

1. Download artifact from EAS → compute SHA-256.
2. Upload APK/IPA + write `latest.json` (immutable filenames; `latest.json` with
   `Cache-Control: max-age=60`).
3. Regenerate `index.html` (en+hi): version, size, SHA-256, install steps
   ("Settings → Allow from this source"), and the two QR codes.
4. Generate QR PNGs pointing at `https://get.bir.example/` (Android) and
   `itms-services://?action=download-manifest&url=https://get.bir.example/ios-adhoc/manifest-<v>.plist`
   (iOS ad-hoc). QRs also go to the print team for gate/venue posters.
5. CloudFront invalidation on `/site/*` and `/android/latest.json`.

**Integrity & safety on this channel**

- APK signed with the **same upload keystore** as Play → `adb shell pm` reports one cert;
  users upgrading between channels never hit signature conflicts.
- Page displays SHA-256 + `apksigner` cert digest; support script verifies a device's
  installed cert.
- App reads `APP_CHANNEL` at runtime → telemetry dimension + in-app "You're on the
  direct channel; updates arrive via this page or Play" notice.
- `latest.json` lets the app self-check for direct-channel updates and deep-link back
  to the page (no self-updating APK download inside the app — keeps Play policy clean
  for the dual-distributed binary).

---

## 4. Signing custody

| Key                                     | Where it lives                                             | Who can touch it            |
| --------------------------------------- | ---------------------------------------------------------- | --------------------------- |
| Android upload keystore                 | EAS secrets (credentials managed) + sealed offline backup  | Convenor's office + IT lead |
| Play app-signing key                    | Google-managed (Play App Signing)                          | —                           |
| Apple distribution cert + profiles      | EAS-managed via ASC API key                                | IT lead                     |
| ASC API key / Play service-account JSON | EAS secrets only — never in repo, never in `stack-outputs` | CI                          |
| Pass-verification JWKS (public)         | Backend `passes.jwksPath`                                  | public by design            |

Claude Code rule: any task needing a credential references the EAS secret name; if the
secret is missing, halt and record it in `docs/BACKEND_ASKS.md`.

---

## 5. CI/CD (GitHub Actions; CodeBuild variant noted)

```
.github/workflows/
  ci.yml        # PR: typecheck, lint, jest, contract:check, hi.json parity, bundle-size
  preview.yml   # push to main: eas build --profile preview (android) → publish-direct → comment QR
  release.yml   # tag v*: eas build --profile production --platform all
                #   → eas submit (Play internal, TestFlight)
                #   → publish-direct (production APK to get.bir.example)
                #   → eas update --channel production (OTA baseline)
  e2e.yml       # nightly: maestro cloud runs on device farm
```

If the org standard is AWS-native CI: mirror the same stages in CodePipeline/CodeBuild
(Node image + `eas-cli`), with secrets in Secrets Manager and the publish step's IAM role
scoped to `appDistBucket` + the CloudFront invalidation — that role is an **export the
backend project must provide** (`ci/appDistPublishRoleArn`, add to contract).

---

## 6. Release runbook (automated by `npm run release`)

1. `git tag v1.x.y` → release.yml fires.
2. Production builds complete → auto-submit: **Play internal track** + **TestFlight**.
3. Smoke suite (Maestro) against internal builds on device farm — must pass.
4. Promote: Play internal → production (staged rollout 10% → 50% → 100% over 3 days);
   App Store submit for review with phased release ON.
5. `publish-direct` updates `get.bir.example` and re-issues QR posters PDF.
6. Announce in-app via Pinpoint (respecting quiet hours) + platform release notes en+hi.
7. Monitor: crash-free sessions, ANR rate, scan-verdict latency dashboard for 48 h.

**Rollback:** halt staged rollout / re-promote previous AAB; flip `latest.json` to the
prior artifact; `eas update --channel production --branch rollback` for JS-level issues.
Target: ≤30 minutes, rehearsed in Phase 7 of the implementation plan.

---

## 7. Store-compliance quick list (Claude Code keeps `store/` current)

- **Play:** Data Safety form (matches DPDP consent registry), Target API level = current
  requirement, foreground-service disclosure for gate-kiosk screen-awake, UPI intent
  handled per Play payments policy (physical-world services → external payment allowed).
- **Apple:** App Privacy labels, Sign-in review notes (OTP demo number), background
  modes limited to `remote-notification`, camera/location purpose strings en+hi,
  TestFlight beta review before festival marketing pushes.
- Both: account-deletion path in-app (contract `restBase /account/delete`), no dynamic
  code loading beyond EAS Update (permitted JS bundle mechanism on both stores).
