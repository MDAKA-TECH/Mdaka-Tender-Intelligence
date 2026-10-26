---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/pages/Tenders.tsx","src/pages/TenderDetail.tsx"]
---

## Scope
Whole app shell and every signed-in page (Tenders list, Tender detail, Vault, Company profile) plus Login/Onboarding. Mode: Operate. Redesign: new visual world, layouts may change, every feature stays.

## Audience and task
Owner-run SA SMEs preparing a government bid at a desk, checking deadlines on a phone in between. Task: review AI-extracted requirements against sources, keep a checklist, never miss a closing date, briefing or expired vault document. Must not feel like a flashy startup or cramped.

## Direction contract
THESIS: The app is the company's bid file. Meaning is carried by binder index-divider colours: every status and every checklist section owns one fixed divider colour, shown as a tab, so you know where you are by colour before reading. Refuses the grey SaaS screen with one teal accent.
OWN-WORLD: Lever-arch binder navy spine (#1a2a5e family) as the left rail with a white spine-label card for the product name; cool bright bond-paper ground (blue-white, never cream); white sheets with hairline edges and soft offset shadows; divider colours: marigold (to review), emerald (prepared/ready), vermilion (disqualification/expired), cobalt (preparing/primary action), violet (submitted), slate (closed). Archivo variable: semi-condensed bold headings, condensed caps tab labels, tabular figures for dates; lucide line icons.
STORY: Open the app, see what closes soon and what is expired; open a tender, see its deadline loudly, work the Review divider until empty, then tick the Checklist divider to green, export, mark submitted.
FIRST VIEWPORT: Tenders list: navy spine rail left; page title and New tender; "Coming up" as a dated strip of rows with divider-colour tags; below it the tender table under coloured status divider tabs (Active, Submitted, Won, Lost...), each row ending in its status tab. Tender detail: a deadline band (closing countdown large, briefing, submission) under the title; main column = Requirements with Review/Checklist divider tabs (or Documents first until the AI has run); side column = Details, Reminders.
FORM: Bid file index tabs; my top-ranked grounded candidate (list position 1, chosen by the user over assigned index 6); seed key 2de4a5b3.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved
None.
