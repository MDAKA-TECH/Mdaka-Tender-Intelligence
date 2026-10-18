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

### Week 3: AI extraction (engine and gate, in progress)
- [x] Fixed JSON schema for all fields in the scope doc; every value has file, page, quote and confidence
- [x] Provider switch: Anthropic, OpenAI or Gemini via `LLM_PROVIDER` in `worker/.env`
- [x] Verifier: every quote is checked against the real page text; wrong pages are corrected,
      quotes that don't exist are marked unverified and low confidence
- [x] Answer key for RFQ 906 and 907 (`test-set/answer-key/`), drafted and quote-checked; awaiting Ruboi's review
- [x] `evaluate.py` scores a run against the answer key using the scope doc's pass bar
- [ ] Run the gate with a real model and pass it
- [ ] Then: worker runs extraction after a tender's PDFs are read, results saved for the week 4 review screen

## Set up

1. Create a new Supabase project (separate from Student360).
2. Supabase → SQL Editor → run each file in `supabase/migrations/` in order
   (`0001_foundations.sql`, then `0002_ingestion.sql`).
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

`python worker.py --once` processes whatever is waiting and exits. `python extract.py file.pdf`
tests extraction on a local file without Supabase.

**OCR (for scanned tenders):** install Tesseract for Windows from
https://github.com/UB-Mannheim/tesseract/wiki (default install path is detected automatically).
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

Cost guide: about 9k input and 3k output tokens per 10-page RFQ.

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

Worker results: both read fully from the text layer (about 2,200 words each). A scanned copy of
RFQ 906 (pages turned into images) was read by OCR with nearly the same word count, at roughly
5 seconds a page. Note: RFQ 906 doesn't say "SBD 4"; it says "declaration of interest form", so
week 3 must match forms by what they are, not only by number.

Still needed: 13–18 more from eTenders, at least 3 of them scanned.
