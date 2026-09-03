# Play Store submission — Bir Festival 2026 (Android AAB)

Two Android artifacts are produced by this repo:

| Artifact                          | Script                       | Contract                                                            | Signing                          | Purpose                                                                |
| --------------------------------- | ---------------------------- | ------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| **Eval APK** (`app-release.apk`)  | `scripts/build-eval-apk.sh`  | `stack-outputs.example.json` (mocks on, OTP `123456`, payments off) | debug key                        | Self-contained demo, sideloaded from the S3 QR page. **Not** for Play. |
| **Store AAB** (`app-release.aab`) | `scripts/build-store-aab.sh` | `config/stack-outputs.json` (live backend, mocks off)               | **upload key** in `credentials/` | Google Play upload.                                                    |

## The upload keystore (read this)

`scripts/build-store-aab.sh` signs with `credentials/upload.keystore` (generated
once; RSA 2048, 10 000-day validity). Its passwords are in
`credentials/keystore.env`. **Both are gitignored — back them up somewhere safe
and private.**

Under **Play App Signing** (the default for new apps) this is the _upload key_,
not the final app-signing key: Google holds the app-signing key, and if the
upload key is ever lost you can reset it from the Play Console. So keep it safe,
but it is recoverable. The repo convention (CLAUDE.md hard-rule 4) is that
release keystores live in **EAS secrets** — migrate this there (or your secret
store) before this goes to a team/CI.

Recommended: enrol the same key as an EAS credential and build via
`eas build --profile production --platform android` (eas.json already defines the
`production` profile as an `app-bundle`, `APP_CHANNEL=store`). The local script
exists so an AAB can be produced without the EAS pipeline.

## Build the AAB

```bash
./scripts/build-store-aab.sh
# -> android/app/build/outputs/bundle/release/app-release.aab
```

## Backend readiness caveat (important)

The live backend is still mid-build (Track B). At the time of writing:

- **Auth** uses the custom-auth Lambda's **fixed dev OTP `000000`** (real random
  OTP over SNS SMS is task **B6**).
- **Payments** are stubbed (task **B5**); Highlights/Lodging/Volunteer/Partner
  domains are live (B1–B4).

So this AAB is appropriate for the Play **internal / closed testing** track, not
a public production release yet. Flip to a public track only after B5 (payments)
and B6 (real OTP) land.

## Submit (internal testing track)

1. Play Console → create the app (package `org.birfestival.app`) if it does not
   exist; opt into **Play App Signing**.
2. **Testing → Internal testing → Create release** → upload the `.aab`.
3. First upload enrols the upload certificate. Add testers, roll out.
4. `versionCode` must increase every upload (currently `8`, from `app.config.ts`).

`eas.json`'s `submit.production.android` is wired for
`eas submit -p android --profile production` once `PLAY_SA_JSON` (a Play service-
account key) is set as an EAS secret — the hands-off path.
