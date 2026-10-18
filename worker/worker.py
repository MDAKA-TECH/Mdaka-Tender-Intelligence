"""Tender PDF extraction worker.

Claims queued tender_files rows, downloads the PDF from the private 'tenders' bucket,
extracts text page by page (OCR for scanned pages) and writes it back.

  python worker.py          # run forever, polling every few seconds
  python worker.py --once   # process everything waiting, then exit

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example). The service_role key
bypasses row-level security: keep it on the server, never in the React app.
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import Client, create_client

from extract import extract_pdf, tesseract_available

BUCKET = "tenders"
POLL_SECONDS = float(os.getenv("POLL_SECONDS", "5"))
MAX_TEXT_CHARS = 2_000_000  # ~1,000 dense pages; protects the row from runaway output

log = logging.getLogger("worker")
_stop = False


def _handle_stop(*_):
    global _stop
    _stop = True
    log.info("Stopping after the current file…")


def connect() -> Client:
    load_dotenv()
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in worker/.env (copy .env.example).")
    return create_client(url, key)


def claim(sb: Client) -> dict | None:
    rows = sb.rpc("claim_tender_file").execute().data or []
    return rows[0] if rows else None


def process(sb: Client, job: dict) -> None:
    fid, name = job["id"], job["file_name"]
    log.info("Extracting %s (attempt %s)", name, job["attempts"])
    started = time.monotonic()
    try:
        data = sb.storage.from_(BUCKET).download(job["file_path"])
        res = extract_pdf(data)
        pages = res.as_json()
        total = sum(len(p["text"]) for p in pages)
        if total > MAX_TEXT_CHARS:
            raise ValueError("The extracted text is unusually large. Split the PDF and upload the parts.")
        if total == 0:
            raise ValueError(
                "No text found. The PDF looks scanned and OCR is not installed on the worker."
                if res.needs_ocr else "No text found in this PDF."
            )
        sb.table("tender_files").update({
            "status": "done",
            "page_count": res.page_count,
            "extracted_text": pages,
            "ocr_used": bool(res.ocr_pages),
            "ocr_pages": res.ocr_pages,
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            # Keep warnings visible in the app without marking the file failed.
            "error": "; ".join(res.warnings) or None,
        }).eq("id", fid).execute()
        log.info("Done %s: %s pages, OCR on %s, %.1fs", name, res.page_count, res.ocr_pages or "none",
                 time.monotonic() - started)
    except Exception as e:  # noqa: BLE001 — any failure is recorded on the row
        msg = str(e) if isinstance(e, ValueError) else f"Extraction failed ({e.__class__.__name__}): {e}"
        log.exception("Failed %s", name)
        sb.table("tender_files").update({"status": "failed", "error": msg[:500]}).eq("id", fid).execute()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="process the queue, then exit")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    signal.signal(signal.SIGINT, _handle_stop)
    signal.signal(signal.SIGTERM, _handle_stop)

    sb = connect()
    log.info("Worker started. OCR %s.", "available" if tesseract_available() else "NOT installed: scanned pages will be skipped")
    while not _stop:
        try:
            job = claim(sb)
        except Exception:  # noqa: BLE001 — network blips shouldn't kill the worker
            log.exception("Could not reach Supabase; retrying in %ss", POLL_SECONDS * 3)
            time.sleep(POLL_SECONDS * 3)
            continue
        if job:
            process(sb, job)
            continue
        if args.once:
            break
        time.sleep(POLL_SECONDS)
    log.info("Worker stopped.")


if __name__ == "__main__":
    main()
