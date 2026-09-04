# AI endpoints — provider, cost & rate limits (B8)

The festival AI features (`/ai/assistant`, `/ai/planner`, `/ai/translate`,
`/ai/queue`) are served by one Cognito-authorized Lambda (`terraform/lambda/ai`)
that calls the **Anthropic Messages API** directly. The app never holds the key
or calls the model — everything goes through this Lambda.

## Where the money goes

Requests run against **the Anthropic account whose API key is in SSM**
(`/bir-2026/ai/anthropic-key`). All usage and billing accrue to that account, so
treat the key as a spend-bearing secret. Set/rotate it with:

```bash
aws ssm put-parameter --profile rhoai-demo --region us-east-1 \
  --name /bir-2026/ai/anthropic-key --type SecureString --overwrite \
  --value '<ANTHROPIC_API_KEY>'
```

No redeploy is needed — the Lambda reads the key from SSM and caches it for the
container's life. (A first set from the placeholder is picked up immediately; a
key→key rotation is picked up as containers recycle, or force it by re-deploying
the `ai` function.)

- **Model:** `var.anthropic_model`, default `claude-haiku-4-5-20251001` — Haiku is
  the low-cost / low-latency tier, the right default for short festival replies.
- **Output caps per route** (`max_tokens`): assistant 600, planner 800,
  translate 400, queue 120. Input is the small system prompt plus the user's text.
- Check current per-token pricing at the Anthropic pricing page; rough cost per
  call ≈ `(input_tokens × input_rate) + (output_tokens × output_rate)`. With Haiku
  and these caps, typical calls are fractions of a cent.

## Per-user rate limit (the scale knob)

To bound cost and abuse, the Lambda enforces a **per-user, per-minute** limit
before it ever calls the model:

| Variable | Meaning | Default |
|---|---|---|
| `ai_rate_limit_per_min` | Max AI requests per user per minute. `0` disables the limit. | `15` |

- Implemented as an atomic DynamoDB per-minute counter row (`AIRL#<sub>` /
  `<minute-bucket>`) with a short TTL, so rows self-expire — no cleanup job.
- Over the limit → the endpoint returns **HTTP 429** `{"error":"rate limited"}`;
  the client should show "try again shortly", not retry in a tight loop.
- **Fail-open:** if the counter write errors, the request is allowed rather than
  blocking a paying visitor.

### Scaling up

Raise the limit and apply — nothing else changes:

```bash
cd bir-backend/terraform
terraform apply -var 'ai_rate_limit_per_min=40'
# or set the default in variables.tf for a permanent change
```

Suggested starting points:

| Situation | `ai_rate_limit_per_min` |
|---|---|
| Internal testing / cautious launch | `10`–`15` (default) |
| Live festival week, normal traffic | `30`–`60` |
| Heavy assistant usage / demos | `120` |
| No app-level cap (rely on Anthropic account limits only) | `0` |

The limit is **per user**, so total load also scales with concurrent visitors —
keep an eye on the Anthropic account's own usage limits and set alerts there for
the festival window.
