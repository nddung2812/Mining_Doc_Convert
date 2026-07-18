# MDocConvert — Mining Doc Factory (MVP)

Automated drafting of client-branded mining documents (SOP, RA, HMP, Proposal) from raw client
source content — with a mandatory human reviewer. Styling is deterministic (docx templates),
content is AI-extracted (one structured call per document), and a qualified person approves every
document before it ships. The AI never touches formatting; the template never touches content.

## Architecture

```
source (.docx/.txt/.md)
   │  mammoth / utf8
   ▼
extraction engine ──► schema-validated JSON (confidence flags, NOT_FOUND markers, warnings)
   │                        │
   │                        ▼
   │                 docxtemplater + templates/<type>.docx  ──► draft .docx
   ▼
audit record (source hash, prompt/schema/template versions, model, tokens, cost, downloads)
```

Two swappable extraction engines:

| Engine | When | Billing |
|---|---|---|
| `cli` — Claude Code CLI (`claude -p`) | Local dev only, no API key configured | Covered by your Claude subscription |
| `api` — Anthropic API | Deployed, or whenever a key is present | Server key (`ANTHROPIC_API_KEY`) or **bring-your-own key** entered per-user in Settings |

Resolution order: per-request BYOK key → `ANTHROPIC_API_KEY` → CLI (local only). Deployed users
without a key get a clear "bring your own key" error — your subscription is never exposed.

## Plain-file contracts (deliberately not code)

- `prompts/extract.md` — the extraction prompt, versioned via its header comment.
- `schemas/*.schema.json` — one JSON Schema per doc type, versioned via a `version` field. This is
  the domain document the expert signs off on.
- `templates/*.docx` — docxtemplater masters. Currently generated placeholders
  (`npm run templates`); after the Phase 0 diff exercise, replace them with pixel-faithful
  client-branded versions **keeping the same `{tags}`** and everything keeps working.

Every run records which prompt/schema/template version produced it.

## Review model (approval gate)

Extraction never renders directly. A run lands in **awaiting review**; a named reviewer inspects
the extracted JSON (confidence flags, NOT FOUND fields, warnings), then approves — which records
their name in the audit trail and releases the deterministic render. Downloads are blocked until
approval. This mirrors Eve's `approval` primitive so both runtimes share one review model.

## Per-client templates

The Clients page registers clients and accepts one branded template per doc type: restyle the
master in Word (fonts, colours, logo, cover) keeping every `{tag}` intact, and upload. Uploads are
dry-run rendered against dummy data on the spot — broken tags are rejected with the exact
docxtemplater explanation. At render time the client's template wins; doc types without one fall
back to the master, and the run's `templateVersion` records exactly which was used
(`client:<id>@<uploadedAt>`).

## Eve agent (Phase 2 shell, prepared)

`agent/` holds the [Eve](https://vercel.com/eve) runtime for the same pipeline (version-pinned;
Eve is beta): `tools/extract.ts` (the one structured call — stores the result and returns only a
run id + review summary, so the chat model can never touch document content) and
`tools/render.ts` (approval-gated via `always()`, shares run storage with the web app).
Per the build plan, the Eve deployment activates after the Phase 1 golden test; this app remains
the permanently working fallback engine.

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `ANTHROPIC_API_KEY` set, extraction shells out to your logged-in `claude` CLI (Max
subscription). Auth is disabled while `APP_PASSWORD` is unset. Runs are stored in `./data/runs/`.

Pipeline tests without spending anything:

```bash
npm run templates    # regenerate templates/*.docx
npm run test:render  # render all three with dummy data → data/test-output/
```

## Deploying to Vercel

1. Push this repo to GitHub and import it in Vercel (or `vercel deploy`).
2. Set environment variables (see `.env.example`):
   - `APP_PASSWORD` — **required**; these are client compliance docs, never deploy open.
   - `DAILY_COST_CAP_USD` — daily API spend cap (default 10).
   - `ANTHROPIC_API_KEY` — optional; leave unset to force every user to bring their own key
     (Settings page), which is the intended multi-user model.
3. Attach a **Vercel Blob** store to the project (Storage tab). `BLOB_READ_WRITE_TOKEN` is injected
   automatically and the app switches from filesystem to Blob storage.

## Non-negotiables baked in

- **No hallucinated safety content**: the prompt demands `NOT_FOUND` over guessing; extraction is
  schema-validated; every gap and low-confidence field is flagged in the UI and rendered as
  `«NOT FOUND — REVIEW REQUIRED»` in the draft; every draft carries a DRAFT footer.
- **Audit log per run**: source filename + SHA-256, prompt/schema/template versions, engine, model,
  token usage, cost, extracted JSON, and download timestamps.
- **Cost guardrail**: API-engine runs stop for the day once `DAILY_COST_CAP_USD` is reached.
- **Auth**: password gate on every page and API route when `APP_PASSWORD` is set.

## Data handling (decide consciously before onboarding a client)

Uploaded source content and extracted JSON are stored in Vercel Blob (deployed) or `./data`
(local) with no automatic retention limit, and source content is sent to Anthropic's API for
extraction. Get the client's written sign-off on this flow before processing their documents.

## Roadmap (matches the build plan)

- Phase 0/1: replace placeholder templates + schemas with expert-signed versions; run the golden
  test (3 previously approved docs re-run through the pipeline; target ≤20 min review, zero
  hallucinated safety fields).
- Phase 3: batch queue, in-app review + approval lock, template/schema version pinning per client,
  PDF source support.
