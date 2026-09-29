# Bir Festival 2026 — New-Machine Bootstrap Prompt

Paste everything in the fenced block below into **Claude Code** on the new laptop
(run it from an empty working directory, e.g. `~/GitHub`). It clones the repo, sets up
the toolchain, wires the two secret/local files that are **not** in git, and verifies.

Two files are deliberately outside version control — you must bring them over from the
old machine first (AirDrop / scp / USB). Nothing works without them:

| File | Why it's not in git | How to get it |
|------|--------------------|---------------|
| `TGHEF-2026/bir-mobile/config/stack-outputs.json` | Secret AWS binding (mode 0600) | Copy from old machine |
| `TGHEF-2026/bir-backend/terraform/terraform.tfstate` (+ `.tfstate.backup`) | **Local** Terraform state — the only record of the live AWS resources | Copy from old machine |

> On the OLD machine, collect them into one folder to carry over:
> ```bash
> mkdir -p ~/bir-handoff && \
>   cp "$HOME/GitHub/company-demos/TGHEF-2026/bir-mobile/config/stack-outputs.json" ~/bir-handoff/ && \
>   cp "$HOME/GitHub/company-demos/TGHEF-2026/bir-backend/terraform/terraform.tfstate"* ~/bir-handoff/
> ```
> Then move `~/bir-handoff` to the new machine (AirDrop is simplest) before running the prompt.

---

## The runnable prompt

```
I'm setting up the Bir Festival 2026 project (repo: company-demos, working subtree TGHEF-2026)
on a fresh Mac. Get me to a working state and verify each step before moving on. Stop and tell
me if any check fails — don't guess or recreate AWS resources.

CONTEXT
- Monorepo of demos; I only work in TGHEF-2026/. Three subprojects:
  - bir-mobile/  Expo SDK 53 / React Native 0.79 app (TypeScript strict)
  - bir-backend/ Terraform (LOCAL state) + Lambda, AWS profile "rhoai-demo" (SSO), acct 406337554361, us-east-1
  - bir-admin/   vanilla-JS web console
- Active branch: co-004-operational. Main branch: sanjeev-dev.
- AWS access is via SSO profile "rhoai-demo". Terraform uses LOCAL state (no remote backend).

I have already copied these two secret/local files into ~/bir-handoff/ from my old machine:
  - stack-outputs.json          (the AWS binding contract)
  - terraform.tfstate + terraform.tfstate.backup  (live Terraform state)

STEPS
1. Verify prerequisites are installed; if any is missing, give me the exact `brew` command and stop:
   - node 25.x + npm 11 (nvm ok), terraform 1.8.5, awscli v2, openjdk 18, git
   - (Android APK builds only) Android command-line tools at /usr/local/share/android-commandlinetools
     with platform-35, build-tools 35.0.0, NDK 27.1.12297006, cmake 3.22.1
2. Clone: git clone https://github.com/sankat447/company-demos.git ~/GitHub/company-demos
   then: cd ~/GitHub/company-demos && git checkout co-004-operational
3. Place the handoff files (fail loudly if ~/bir-handoff is missing either one):
   - cp ~/bir-handoff/stack-outputs.json  TGHEF-2026/bir-mobile/config/stack-outputs.json && chmod 600 that file
   - cp ~/bir-handoff/terraform.tfstate*  TGHEF-2026/bir-backend/terraform/
4. Configure AWS SSO profile "rhoai-demo" if absent (SSO start URL + region us-east-1, acct 406337554361,
   role from the old ~/.aws/config), then run: aws sso login --profile rhoai-demo
   Verify: aws sts get-caller-identity --profile rhoai-demo  → shows account 406337554361
5. bir-mobile deps: cd TGHEF-2026/bir-mobile && npm install
6. VERIFY (these must all pass — report the output of each):
   - cd TGHEF-2026/bir-mobile && npm run contract:check   # stack-outputs.json valid
   - npm run typecheck                                     # tsc clean
   - cd ../bir-backend/terraform && terraform init && terraform plan
       → EXPECT "No changes. Your infrastructure matches the configuration."
         If terraform plan wants to CREATE resources, STOP — the tfstate didn't transfer. Do not apply.
7. Summarize what's ready, and what's still needed only if I want to build the Android APK
   (Android SDK env: ANDROID_SDK_ROOT, local.properties sdk.dir, JAVA_HOME=openjdk-18).

Do NOT run `terraform apply`, `npm run build:*`, or any deploy.sh during setup — setup is read-only
against AWS except for `aws sso login`.
```

---

## Notes / gotchas the prompt encodes

- **Terraform state is local.** If `terraform plan` proposes to *create* the pool/table/API,
  the `.tfstate` didn't come across — copy it, don't apply. (A cleaner long-term fix is migrating
  state to an S3 backend so a laptop swap is a non-event; not required for the demo.)
- **`stack-outputs.json` is the single AWS binding** for the app (`src/config/stack.ts`).
  `contract:check` validates it against `schemas/stack-contract.schema.json`.
- **AWS auth is SSO**, token expires — `aws sso login --profile rhoai-demo` whenever calls start failing.
- **`bir-admin/config.js` is tracked** (already in git) — nothing to transfer there.
- Android SDK is only needed to build the APK locally; the app runs in Expo/emulator without it.
