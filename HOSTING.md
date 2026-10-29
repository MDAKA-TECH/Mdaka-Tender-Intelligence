# Hosting Tender Intelligence

The app has three parts. Each lives in a different place:

| Part | Where | What it does |
|---|---|---|
| Web app (React) | **Vercel** | The screens people use |
| Database, logins, files, reminder emails | **Supabase** (already hosted) | Data, auth, storage, the `send-reminders` function and its hourly schedule |
| PDF + AI worker (`worker/`) | **Railway** (or Render / Fly.io) | Reads uploaded PDFs (OCR for scans) and runs the AI extraction, 24/7 |

Keys: the **anon** key goes to Vercel. The **service_role** key goes only to the worker host. Never mix them up,
never commit either, never paste them in chat.

---

## 1. Push the code

From the project folder:

```
git status            # .env, .env.local and worker/.env must NOT be listed
git add .
git commit -m "Ready to host"
git push
```

## 2. Web app on Vercel (about 15 minutes)

1. vercel.com → **Add New → Project** → import the `tender-intel` repo from the MDAKA-TECH GitHub org
   (give Vercel's GitHub app access to the org if it asks).
2. Framework: **Vite** (detected). Root directory: the repo root. Build command and output come from `vercel.json`.
3. **Environment Variables** — add both, for Production and Preview:
   - `VITE_SUPABASE_URL` = `https://qwpovznioeicizixdpqa.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon key (same as in `.env.local`)
4. **Deploy**. You get an address like `tender-intel-xxxx.vercel.app`.
5. Optional custom address: Project → **Settings → Domains** → add `tenders.mdakatech.com`. mdakatech.com's DNS is
   already on Vercel, so it connects by itself.

Every `git push` to the main branch redeploys automatically.

## 3. Tell Supabase about the live address

1. Supabase → **Authentication → URL Configuration**:
   - Site URL: your live address (e.g. `https://tenders.mdakatech.com`)
   - Redirect URLs: add the same address, and keep `http://localhost:5173` for local testing.
2. Make reminder-email links open the live app:
   ```
   npx supabase secrets set --project-ref qwpovznioeicizixdpqa APP_URL=https://tenders.mdakatech.com
   ```
3. Sign up / sign in on the live address once to check the confirmation email link lands on the live site.

## 4. Worker on Railway (about 20 minutes)

The worker folder has a `Dockerfile` (Python 3.12 + Tesseract OCR, runs as a non-root user, no secrets inside).

1. railway.com → sign in with GitHub → **New Project → Deploy from GitHub repo** → pick `tender-intel`.
2. Open the new service → **Settings**:
   - **Root Directory**: `/worker` (Railway then finds the Dockerfile).
   - No public domain or port is needed: the worker only talks out to Supabase and Gemini.
3. **Variables** → **Raw Editor** → paste the contents of your `worker\.env` (the same names and values), e.g.
   ```
   SUPABASE_URL=https://qwpovznioeicizixdpqa.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   POLL_SECONDS=5
   LLM_PROVIDER=gemini
   LLM_MODEL=...
   LLM_FALLBACK_MODEL=...
   GEMINI_API_KEY=...
   ```
   Type or paste these in Railway's dashboard only.
4. Deploy. In **Deployments → Logs** you should see the start-up line with OCR **available** and
   **AI extraction on (gemini)**.
5. Test: upload a tender in the live app. Files go Waiting → Reading… → Read, then the AI runs.
6. Stop the worker on your PC (Ctrl+C). Running both is safe (jobs are claimed, never done twice), but there is no
   need for two.

Render or Fly.io work the same way: point them at `worker/Dockerfile` and add the same environment variables.
On Render choose **Background Worker** (not Web Service).

## 5. Before outside companies use it

- **Gemini**: switch to a paid API key (free-tier prompts may be read by Google). Change `GEMINI_API_KEY` on Railway.
- **Supabase Pro**: free projects pause after about a week without activity and have small storage; Pro adds backups.
- **Vercel Pro**: the free Hobby plan is for non-commercial use.
- **Admin alerts**: set `ADMIN_EMAIL` on the send-reminders function (`npx supabase secrets set ... ADMIN_EMAIL=...`) so you
  hear about it the first time the AI account runs out of credit or quota. Users then see "AI extraction is paused for
  your account" instead of a technical error.
- **Resend**: the mdakatech.com domain must show Verified, and `REMINDER_FROM` uses `@mdakatech.com`.
- Privacy notice and terms page (POPIA: the vault holds directors' IDs).

## 6. Quick health checks

- Live site loads and you can sign in.
- New tender → files read within a minute (worker logs show the job).
- Company profile → **Send test email** arrives.
- Supabase SQL: `select status_code from net._http_response order by created desc limit 3;` shows `200`
  (hourly reminder run).
