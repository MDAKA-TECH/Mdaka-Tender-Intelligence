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

## 4A. Worker on Oracle Cloud, free (about 45 minutes the first time)

Files: `worker/deploy/oracle-cloud-init.yaml`, `worker/deploy/setup-worker.sh`, `worker/deploy/update-worker.sh`.

**Account**
1. oracle.com/cloud/free → Start for free. **Home region: South Africa Central (Johannesburg).** It can't be changed later,
   and free servers only run in the home region. A card is needed for verification; stay on the Free Tier account.

**Server**
2. Console → Compute → Instances → **Create instance**:
   - Name: `tender-worker`
   - Image: **Canonical Ubuntu 24.04** (the aarch64/Arm build is picked automatically for Ampere)
   - Shape: **Ampere → VM.Standard.A1.Flex**, **1 OCPU, 2 GB memory** (keeps memory use above the 20% "idle" line)
   - Networking: keep the defaults (new VCN, public subnet, assign a public IPv4 address)
   - SSH keys: **Generate a key pair for me** → **Save private key** (keep it safe; it's the only way in)
   - Boot volume: default size
   - Advanced options → Management → **Paste cloud-init script** → paste all of `oracle-cloud-init.yaml`
   - Create. Wait until it shows **Running**, then about 5 more minutes for first-boot setup. Copy the **Public IP address**.

**Connect** (Windows PowerShell, in the folder where the key was saved)
3. `icacls .\ssh-key-*.key /inheritance:r /grant:r "$($env:USERNAME):(R)"` (Windows: lock the key file down once)
4. `ssh -i .\ssh-key-<date>.key ubuntu@<public-ip>` → type `yes` the first time.

**Install the worker**
5. On the server, get the setup script onto it: `nano setup-worker.sh`, paste the contents of `worker/deploy/setup-worker.sh`,
   save (Ctrl+O, Enter, Ctrl+X), then run `bash setup-worker.sh`.
6. The script shows a **deploy key**. In GitHub: `MDAKA-TECH/Mdaka-Tender-Intelligence` → Settings → **Deploy keys** →
   Add deploy key, title `oracle-worker`, paste it, **leave "Allow write access" off** → Add. Back in the server, press Enter.
7. When nano opens, paste the contents of your PC's `worker\.env` (no quotes around values), save and exit.
8. The script builds and starts the worker and prints its log. Look for **OCR available** and **AI extraction on (gemini)**.
9. Upload a test tender on the live site; it should be read within a minute. Then stop the worker on your PC (Ctrl+C).

**Later**
- Follow the log: `docker logs -f tender-worker` (Ctrl+C stops following, not the worker).
- After you push worker changes to GitHub: `bash /opt/tender-intel/worker/deploy/update-worker.sh`.
- The worker restarts by itself after a crash or a server reboot.
- First week: Oracle console → the instance → Metrics → check **Memory utilization** sits above 20%. If Oracle ever
  reclaims the server, nothing is lost: uploads wait as "Waiting" until a worker runs again (your PC, or a new server
  set up with the same steps).

## 4B. Worker on Railway instead (about 20 minutes, ~$5/month)

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
