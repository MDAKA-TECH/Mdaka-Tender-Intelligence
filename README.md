# Mdaka Tender Intelligence

Turns a tender PDF into a checked compliance checklist. Built by Mdaka Advanced Technologies.
Scope and build plan: the "Mdaka Tender Intelligence — MVP Scope" doc.

Stack: React 18 + Vite + TypeScript, Supabase (Postgres, Auth, Storage), hosted on Vercel.
Same setup as Student360.

## Status: week 1 (Foundations)

- [x] Database schema: all 8 tables from the scope doc, with row-level security per company
- [x] Private storage buckets `vault` and `tenders`, folder-per-company policies
- [x] Email sign-up / sign-in, then a one-step "set up your company" screen
- [x] Document vault: upload, replace (keeps earlier versions), view via signed link, edit dates, delete
- [x] Expiry status (valid / expiring within 30 days / expired / missing) and expiry reminder rows
      (30, 7 and 1 day before; the email sender comes in week 5)
- [x] Company profile (name, CSD number, B-BBEE level)
- [ ] Week 2: tender upload + text/OCR extraction worker

## Set up

1. Create a new Supabase project (separate from Student360).
2. Supabase → SQL Editor → paste and run `supabase/migrations/0001_foundations.sql`.
   It creates the tables, RLS policies, the `create_company` function and both storage buckets.
3. Supabase → Authentication → URL Configuration: set Site URL to `http://localhost:5173`
   (add your Vercel URL later). Email confirmation is on by default; keep it on.
4. Copy `.env.example` to `.env.local` and fill in the project URL and anon key
   (Project Settings → API).
5. `npm install` then `npm run dev`, open http://localhost:5173, create an account, confirm the email,
   and set up the company.

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

Still needed: 13–18 more from eTenders, at least 3 of them scanned.
