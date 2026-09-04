# Notifications & safety alerts

How a message reaches festival-goers — and the honest state of each channel for
the first live version. The driving requirement is the **"sky closed" safety
alert**: it must reach people quickly.

## Channels

| Channel | Reaches | State | Needs |
|---|---|---|---|
| **Fly-status subscription** (AppSync `onFlyStatusChanged`) | app **open** | ✅ live | — |
| **Announcements** (`announcements` query, home surface) | app **opened** (pull) | ✅ live (Step 2) | — |
| **OS push** (FCM / APNs) | app **closed/backgrounded** | ⛔ not delivered | Firebase (below) |
| **SMS broadcast** (Fast2SMS) | any phone | ⛔ gated | Fast2SMS + India DLT |

So today: an alert reaches anyone with the app **open** instantly (subscription),
and anyone who **opens** the app (announcements). Reaching a **closed** app needs
either OS push or an SMS broadcast — both are operator-credential-gated.

## What shipped in Step 2

- **Announcements reader** — the ops console could post notices but nothing read
  them; visitors now see active notices (bilingual, alert level in flag-red) on
  the home, offline-cached. Post an **alert**-level announcement for a safety
  message.
- The fly-status banner already flips live via the AppSync subscription.

## To enable OS push (operator)

Device tokens are already captured (`registerDevice` → `DEVICE#<sub>`), and
`set-fly-status` already publishes to the `fly_status` SNS topic. What's missing
is the **fan-out to FCM** and the credentials it needs:

1. Create a Firebase project; add the Android app (`org.birfestival.app`).
2. Put the **sender id** in `var.fcm_sender_id` and rebuild the app contract.
3. Provide an FCM **service account** JSON (SSM SecureString) for the sender.
4. Add the fan-out Lambda (subscribe it to the `fly_status` SNS topic + announce
   posts): read `DEVICE#` tokens → FCM HTTP v1 send. Gate it on the service
   account like the other creds (no-op until set).

This is a self-contained follow-up once Firebase exists — it was deliberately not
built blind, because it cannot be verified end-to-end without real Firebase
credentials, and an unverifiable safety path is worse than an honest gap.

## Recommendation for v1

Ship with the **in-app** channels (subscription + announcements) as the primary
safety surface, and decide between **FCM push** and **SMS broadcast** for
closed-app reach based on which credential path (Firebase vs Fast2SMS+DLT) the
operator completes first. Do not claim push works until a real device receives a
backgrounded alert in a smoke test.
