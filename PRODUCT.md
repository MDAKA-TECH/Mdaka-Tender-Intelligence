# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Owner-run South African SMEs that bid on public-sector work: usually the owner or one admin person preparing a government RFQ or tender at a desk, and checking deadlines on a phone in between. First user is Mdaka Advanced Technologies itself, on its own bids. Bigger bid teams are a later audience, not the design target.

## Product Purpose
Tender Intelligence turns a tender pack (40–80 page PDFs, annexures, SBD forms) into a checked compliance checklist in minutes, so no bid is lost on paperwork: a missing SBD form, an expired tax compliance status, a missed compulsory briefing or a late submission. Version 1 must prove the AI pulls closing dates and mandatory documents accurately, that Mdaka uses it on every bid, and that at least 3 outside SMEs would pay for it.

## Positioning
Every extracted fact links back to the exact page and quote in the tender, and nothing reaches the checklist until a person confirms it. The checklist is matched against the company's own document vault (tax PIN, CSD report, B-BBEE, CIPC) and its expiry dates, measured against the tender's closing date.

## Operating Context
- Workflow: set up the vault once → create a tender and upload its PDFs → worker reads them (OCR for scans) and the AI extracts fields → review and confirm each item against its source page → checklist with vault matching → tick items off while preparing → email reminders before briefing and closing → mark submitted, then won or lost.
- Documents: SA government tender packs (SBD 1, SBD 4, SBD 6.1, MBD forms, CSD reports, TCS PIN, B-BBEE certificates or sworn affidavits, CIPC registration), eTenders and provincial/municipal RFQs.
- Terminology the users know: RFQ, tender, closing date, compulsory briefing, SBD forms, CSD, TCS PIN, B-BBEE level, 80/20 and 90/10 preference points, functionality, bid validity.
- Times are South African (SAST); dates in en-ZA format.

## Capabilities and Constraints
- Pages: Tenders list (status tabs, search, coming-up deadlines), Tender detail (documents, details form, status, export PDF, reminders, review/checklist tabs, activity log), Document vault, Company profile (incl. email reminder settings), Login, Onboarding.
- Stack: React 18 + Vite + TypeScript, plain CSS (`src/styles.css`, tokens on `:root`), Supabase, deployed on Vercel. No UI framework.
- One user per company in v1. Responsive web; no native app.
- AI output is never presented as final: confidence levels, "quote not found" and "keyword check" flags, and source links must stay visible.
- The app must never say a bid is "compliant"; the user checks the tender document themselves.

## Brand Commitments
- Product name: Tender Intelligence, by Mdaka Advanced Technologies (Mdaka Tech).
- Must feel trustworthy for compliance work: not a flashy startup (no gradients, glow or playful illustration), and not cramped.

## Evidence on Hand
- Real test tenders in `test-set/` (Parliament RFQ 906/907, Transport Economic Regulator 4-file pack, Limpopo DPWRI scanned tender) with a passing extraction gate (4/4).
- No customers, testimonials or pricing yet; do not invent any.

## Product Principles
1. Every fact shows where it came from; the source is one click away.
2. A person confirms before anything is relied on; unreviewed and low-confidence items come first and stay visibly distinct.
3. Deadlines and expiry problems are the loudest things on any screen.
4. Calm, roomy and legible for a long working session; dense only where scanning a list needs it.
5. Never overclaim: no "compliant", no invented proof.
