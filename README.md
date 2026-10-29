# Mdaka Tender Intelligence

Turns a tender PDF into a checked compliance checklist. Built by Mdaka Advanced Technologies.
Scope and build plan: the "Mdaka Tender Intelligence — MVP Scope" doc.

Stack: React 18 + Vite + TypeScript, Supabase (Postgres, Auth, Storage), hosted on Vercel.
Same setup as Student360.

## Status

### Week 1: Foundations (done, verified on the live Supabase project)

- [x] Database schema: all 8 tables from the scope doc, with row-level security per company
- [x] Private storage buckets `vault` and `tenders`, folder-per-company policies
- [x] Email sign-up / sign-in, then a one-step "set up your company" screen
- [x] Document vault: upload, replace (keeps earlier versions), view via signed link, edit dates, delete
- [x] Expiry status (valid / expiring within 30 days / expired / missing) and expiry reminder rows
      (30, 7 and 1 day before; the email sender comes in week 5)
- [x] Company profile (name, CSD number, B-BBEE level)

### Week 2: PDF ingestion
- [x] Tenders list (closing countdown, files read, status) and tender detail page
- [x] Create a tender and upload several PDFs (main document, annexures, SBD forms; 50 MB each)
- [x] Extraction worker (`worker/`): reads each PDF page by page, OCR fallback for scanned pages
- [x] Live processing status (waiting / reading / read / failed), retry, page-text viewer with search
- [x] Edit tender details (reference, issuer, closing, briefing, status); delete files or the whole tender

### Week 3: AI extraction (gate passed 26 Oct 2026)
- [x] Fixed JSON schema for all fields in the scope doc; every value has file, page, quote and confidence
- [x] Provider switch: Anthropic, OpenAI or Gemini via `LLM_PROVIDER` (testing on free-tier Gemini Flash)
- [x] Verifier: every quote is checked against the real page text (tolerates table layouts); wrong pages are
      corrected, quotes that don't exist are marked unverified and low confidence
- [x] Keyword safety net: standard vault documents and forms (tax PIN, CSD, B-BBEE, CIPC, bank letter, COID,
      pricing schedule, SBD 4, SBD 6.1) are added at low confidence if the text asks for them and the AI missed them
- [x] Parallel OCR with progress, cached for evaluation runs
- [x] `evaluate.py` gate: **4/4 tenders pass** (Parliament RFQ 906 + 907, Transport Economic Regulator 4-file pack,
      Limpopo DPWRI 56-page scanned tender)
- [x] Worker runs AI extraction automatically once all of a tender's PDFs are read (later runs on request:
      "Re-run"), saving tender facts and unconfirmed requirement rows (`ai_job.py`, migration 0003)
- [x] Tender page shows the AI results (unconfirmed): key facts, documents, disqualifiers, each with a link
      to its source page, confidence, and keyword-check / quote-not-found flags
- [ ] Grow the test set towards 15-20 tenders (scope doc), incl. more scans

### Week 4: Review screen, checklist and vault matching
- [x] Review tab: AI items sorted so keyword-check, unverified and low-confidence items come first; each one
      can be confirmed, edited or marked "Not required"; "Confirm all high-confidence" for the rest
- [x] Add your own items; editing shows what the tender says (the quote) next to the fields
- [x] "Fill tender details" copies the AI's key facts (reference, issuer, description, closing, briefing)
      into the details form for you to check and save
- [x] Checklist tab: tick documents as prepared; each one is matched to the vault (in vault, ready,
      expires before closing, expired, missing) with an Upload/Replace shortcut
- [x] Disqualifiers and other requirements listed separately; "not required" items can be restored
- [x] Re-running the AI keeps everything you confirmed, edited, added or marked "not required", and does not
      add those items back (`drop_already_decided` in `ai_job.py`)
- [x] Tender list shows "N to review" or "x/y prepared" per tender
- No new migration: week 4 uses the columns added in 0001 and 0003

### Week 5: Reminders, tender list, PDF export
- [x] Email reminders (migration 0004 + `send-reminders` Edge Function + Resend): closing dates 7 and 2 days
      before and on the day, briefings 2 days before and on the day (unless optional), vault documents 30, 7
      and 1 day before expiry. One digest email per company, about 08:00 SAST
- [x] Reminders follow the tender: changing dates reschedules them; Submitted / Won / Lost / Not bidding
      stops them. Stale ones (event passed, replaced vault document, more than a day late) are skipped
- [x] Company profile: reminders on/off and "Send test email"; tender page shows the scheduled reminders
- [x] Tender list: status tabs with counts, search, "Coming up" (next 14 days + expiring vault documents),
      "Closed: update status" flag
- [x] Status control on the tender page; marking Submitted warns about unticked mandatory documents
      and unreviewed AI items
- [x] Export PDF: checklist with tick boxes, vault status, sources, disqualifiers, key facts, unreviewed
      items and a disclaimer
- [x] Activity log (`audit_log`): who confirmed, ticked, edited or deleted what, and status/date changes
- [x] Links in emails open the right page (`#/tenders/<id>`, `#/vault`)

## Set up

1. Create a new Supabase project (separate from Student360).
2. Supabase → SQL Editor → run each file in `supabase/migrations/` in order
   (`0001_foundations.sql`, `0002_ingestion.sql`, `0003_ai_extraction.sql`, `0004_reminders.sql`, `0005_ai_errors.sql`, then `0006_storage_cleanup.sql`).
3. Supabase → Authentication → URL Configuration: set Site URL to `http://localhost:5173`
   (add your Vercel URL later). Email confirmation is on by default; keep it on.
4. Copy `.env.example` to `.env.local` and fill in the project URL and anon key
   (Project Settings → API).
5. `npm install` then `npm run dev`, open http://localhost:5173, create an account, confirm the email,
   and set up the company.

## Extraction worker

The worker turns uploaded PDFs into page-by-page text. It uses the Supabase **service_role** key,
so it runs on your machine or a server, never in the browser.

```powershell
cd worker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # then paste the service_role key into worker\.env
python worker.py            # leave running; Ctrl+C to stop
```

With `LLM_PROVIDER` and its API key set in `worker\.env`, the same worker also runs AI extraction:
it prints `AI extraction on (gemini)` when it starts. Without them it only reads the PDFs.

`python worker.py --once` processes whatever is waiting and exits. `python extract.py file.pdf`
tests extraction on a local file without Supabase.

**OCR (for scanned tenders):** install Tesseract for Windows, either with
`winget install -e --id UB-Mannheim.TesseractOCR` or the installer from
https://github.com/UB-Mannheim/tesseract/wiki (the default install path is detected automatically).
`evaluate.py` skips scanned tenders (and reports the gate as INCOMPLETE) until it's installed.
Without it, text PDFs still work; scanned pages are skipped and the file shows a warning.

**Hosting later:** `worker/Dockerfile` includes Tesseract. Deploy it as a background worker on
Render or Fly.io with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as secrets.

## AI extraction and the week 3 gate

1. Get an API key from one provider and set `LLM_PROVIDER` + its key in `worker\.env`.
2. Check `test-set/answer-key/REVIEW.md` against the PDFs (fix any row in `make_keys.py`, run it again).
3. Run the gate:
   ```powershell
   cd worker
   .venv\Scripts\activate
   pip install -r requirements.txt
   python evaluate.py
   ```
   It prints every field as OK / LOW (wrong but flagged) / XX (wrong) / MISS, lists extra documents
   the AI found, and ends with `GATE: PASS` or `GATE: FAIL`. Outputs are saved under `test-set/results/`.
4. Try one tender on its own: `python ai_extract.py ..\test-set\RFQ_906_2026.pdf`

**Pass bar:** closing date and every core mandatory document correct or flagged low confidence (none
wrong at medium/high, none missed); all other fields 90%+ correct.

**Tests (no API key needed):** `python tests/test_pipeline.py` plays simulated answers through the
pipeline and checks that an invented closing time, a missed form and a fake quote all fail the gate.
`python tests/test_ai_job.py` runs the worker's AI step against an in-memory database.

Cost guide: about 9k input and 3k output tokens per 10-page RFQ.

## Email reminders (set up once)

Reminder rows are created by the database (migration 0004). The `send-reminders` Edge Function sends
them with [Resend](https://resend.com); Supabase's pg_cron calls it every hour.

1. **Resend.** Sign up, then Domains → Add domain → `mdakatech.com` (region: Ireland). Add the DNS
   records Resend shows in Vercel → Domains → mdakatech.com → DNS. They go on the `send` subdomain and
   `resend._domainkey`, so existing email for the domain is not affected. Wait for "Verified", then
   API Keys → Create (sending access only).
   Until the domain is verified, use `onboarding@resend.dev` as the sender; it only delivers to the
   email address of your Resend account.
2. **A cron secret.** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. **Deploy the function** (from the project folder; type the secrets in your terminal, never in chat or a file in the repo):
   ```
   npx supabase login
   npx supabase functions deploy send-reminders --project-ref qwpovznioeicizixdpqa --use-api
   npx supabase secrets set --project-ref qwpovznioeicizixdpqa RESEND_API_KEY=re_xxx CRON_SECRET=xxx APP_URL=http://localhost:5173 "REMINDER_FROM=Tender Intelligence <reminders@mdakatech.com>"
   ```
   Optional but recommended: `npx supabase secrets set --project-ref qwpovznioeicizixdpqa ADMIN_EMAIL=you@mdakatech.com`
   so you get an email (at most once a day) when the AI account runs out of credit or its key stops working.
   `supabase/config.toml` turns off the gateway's JWT check for this function; the function checks the
   cron secret (hourly run) or the signed-in user's token (test email) itself. Change `APP_URL` to the
   Vercel URL once the app is deployed.
4. **Test.** In the app: Company profile → Send test email.
5. **Schedule.** SQL Editor: run the `vault.create_secret(...)` line from `supabase/cron_send_reminders.sql`
   with your cron secret, clear it from the editor, then run the rest of that file.
6. **Check.** `select kind, remind_at, outcome, last_error from reminders order by remind_at desc limit 20;`
   Function logs: Supabase → Edge Functions → send-reminders → Logs.

Tests: `deno test --allow-env --allow-read --allow-net supabase/functions/send-reminders/` (run it from
a folder without `node_modules`, or copy the function folder out first).

## Deploy (Vercel)

Import the repo, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Environment Variables,
deploy, then add the Vercel URL to Supabase's Redirect URLs.

## Security model

- Every table has `company_id`, defaulted from the signed-in user. RLS allows a row only if it
  belongs to the caller's company; a forged `company_id` is rejected.
- Child rows use composite foreign keys `(tender_id, company_id)`, so they can't point at another
  company's tender or document.
- Files live at `<company_id>/...` in private buckets and are opened only through 60-second signed URLs.
- Tested on Postgres 16 with two companies: neither can read, write or reference the other's rows or
  files, and a user without a company sees nothing.

## Test set

`test-set/` holds the tender PDFs used to measure extraction (week 3 gate):

| File | Pages | Type |
| --- | --- | --- |
| RFQ_906_2026.pdf (Parliament, Data Analyst) | 10 | Text (Word export) |
| RFQ_907_2026.pdf (Parliament, Data Engineer) | 9 | Text (Word export) |
| Transport Economic Regulator RFQ TER/RFQ2026/27/03 (4 files: RFQ, SBD 4, SBD 6.1, POPIA consent) | 11 + 3 + 5 + 3 | Text |
| Limpopo DPWRI LDPWRI-P/20675, office accommodation Soekmekaar | 56 | Fully scanned (OCR) |
| Notice 6 of 2026/27 (City of Tshwane tender advert) | 11 | Mixed; not scored: it lists ~19 tenders, kept for v2 discovery |

Worker results: both read fully from the text layer (about 2,200 words each). A scanned copy of
RFQ 906 (pages turned into images) was read by OCR with nearly the same word count, at roughly
5 seconds a page. Note: RFQ 906 doesn't say "SBD 4"; it says "declaration of interest form", so
week 3 must match forms by what they are, not only by number.

Still needed: 13–18 more from eTenders, at least 3 of them scanned.
