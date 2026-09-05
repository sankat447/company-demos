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

---

## Knowledge base (RAG) — teaching the assistant

`/ai/assistant` is **retrieval-augmented**: on every question it loads all
curated FAQs plus the top-matching chunks of the rules/instructions you've
dropped in the KB bucket, and answers **only** from that knowledge (deferring to
the help desk when something isn't covered). Two ways to feed it:

### 1. Drop documents in the KB bucket

The private bucket is the `kb_bucket` Terraform output (e.g.
`bir-2026-kb-…`). Upload Markdown, plain text, or JSON — an ingestion Lambda
chunks each doc (by heading) into the knowledge base automatically:

```bash
KB=$(cd bir-backend/terraform && terraform output -raw kb_bucket)
aws s3 cp festival-rules.md         "s3://$KB/kb/festival-rules.md"        --profile rhoai-demo
aws s3 cp paragliding-safety.md     "s3://$KB/kb/paragliding-safety.md"    --profile rhoai-demo
# Re-uploading the same key re-ingests it (old chunks replaced).
# Removing the object removes its chunks:
aws s3 rm "s3://$KB/kb/paragliding-safety.md" --profile rhoai-demo
```

- **Markdown is best** — `#`/`##` headings become chunk titles and split points.
- JSON may be `{title,text}`, `{chunks:[…]}`, or an array of `{title,text}`.
- **PDFs are not parsed** (that needs a bundled parser); convert to `.md`/`.txt`.
- `var.ai_kb_top_k` (default **6**) controls how many chunks are retrieved per
  question — raise it for a larger rules corpus.

### 2. Live FAQ endpoints (adapt during the event)

Organisers (`organiser-lite` / `safety-officer`) add or edit FAQs at runtime —
**no deploy** — and they take effect on the very next question. FAQs are always
loaded into the assistant's context and are preferred for direct matches.

| Route | Purpose | Body / param |
|---|---|---|
| `POST /ai/faq` | Add or update an FAQ | `{ "id"?, "question", "answer" }` — omit `id` to create |
| `GET /ai/faq` | List all FAQs | — |
| `DELETE /ai/faq/{id}` | Remove an FAQ | path `id` |

```bash
curl -X POST "$REST/ai/faq" -H "Authorization: Bearer $ID_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"question":"Where is lost and found?","answer":"Main Help Desk by the Chogan Ground entrance, 8 AM–9 PM."}'
```

### Retrieval quality & the upgrade path

Retrieval is **lexical** today (term-overlap scoring) — no extra API key, cheap,
and ample for a festival-sized corpus. If the rules corpus grows large or you
want paraphrase-robust recall, the `retrieve()` function in `lambda/ai/index.js`
is the single seam to swap in **semantic embeddings** (e.g. Voyage AI / OpenAI
embeddings + a vector index); everything else — ingestion, FAQ, prompts — stays
the same. That upgrade needs a second owner-side key and is the only reason to
revisit this.
