"""AI extraction for one tender, as run by the worker.

Reads the page text of every file of the tender that has been read, runs extraction +
verification + keyword safety net (ai_extract.extract_fields), and saves:
  * tenders.ai_fields — tender-level facts with their sources, plus a summary
  * requirements      — one unconfirmed row per document, disqualifier and special requirement
A re-run replaces earlier unconfirmed AI rows; rows a person confirmed or added are kept.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import llm
from ai_extract import extract_fields
from verify import FIELD_KEYS

log = logging.getLogger("worker.ai")

KIND_BY_CATEGORY = {
    "form": "form", "declaration": "form", "registration": "certification", "certificate": "certification",
    "pricing": "pricing", "financial": "document", "technical": "document", "company_info": "document", "other": "document",
}


class NoReadableFiles(ValueError):
    """The tender has no successfully read PDFs; the user can fix this themselves."""


def error_kind(e: Exception) -> str:
    """busy | account | input | other — decides the message the user sees."""
    if isinstance(e, NoReadableFiles):
        return "input"
    if isinstance(e, llm.LLMError):
        return e.kind
    return "other"


def alert_admin(sb, message: str) -> None:
    """Record an admin alert (at most one per kind per 24 h); the hourly send-reminders run emails it."""
    try:
        sb.rpc("raise_system_alert", {"p_kind": "ai_account", "p_message": message[:1000]}).execute()
    except Exception:  # noqa: BLE001 — alerting must never hide the original failure
        log.exception("Could not record the admin alert")


def load_files(sb, tender_id: str) -> tuple[list[dict], list[str]]:
    """Read files in upload order. The order sets the file numbers the AI cites (1 = first)."""
    rows = (sb.table("tender_files").select("id, file_name, extracted_text")
            .eq("tender_id", tender_id).eq("status", "done").order("created_at").execute().data) or []
    files = [{"name": r["file_name"], "pages": r["extracted_text"] or []} for r in rows]
    return files, [r["id"] for r in rows]


def _source(item: dict, file_ids: list[str]) -> tuple[str | None, int | None]:
    f = item.get("file")
    if isinstance(f, int) and 1 <= f <= len(file_ids):
        return file_ids[f - 1], item.get("page")
    return None, None


def requirement_rows(checked: dict, tender_id: str, company_id: str, file_ids: list[str]) -> list[dict]:
    rows: list[dict] = []

    def add(kind: str, description: str, item: dict, **extra) -> None:
        fid, page = _source(item, file_ids)
        rows.append({
            "tender_id": tender_id, "company_id": company_id, "kind": kind, "description": description[:500],
            "source_file_id": fid, "source_page": page if fid else None,
            "confidence": item.get("confidence"), "quote": item.get("quote"), "verified": item.get("verified"),
            "notes": item.get("notes") or [], "added_by": item.get("added_by") or "ai",
            "confirmed": False, "status": "todo", "sort_order": len(rows), **extra,
        })

    for r in checked["returnables"]:
        add(KIND_BY_CATEGORY.get(r.get("category"), "document"), r["name"], r,
            doc_type=r.get("maps_to"), mandatory=bool(r.get("mandatory")), conditions=r.get("conditions"))
    for d in checked["disqualifiers"]:
        add("disqualifier", d["condition"], d, mandatory=True)
    for s in checked["special_requirements"]:
        add("special", s["requirement"], s, mandatory=True)
    return rows


def _norm(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def drop_already_decided(rows: list[dict], decided: list[dict]) -> list[dict]:
    """Skip new AI rows a person already dealt with: confirmed, edited or marked "not required".
    Same vault document type, or the same description, counts as the same item."""
    seen_types = {(d.get("kind") == "disqualifier", d["doc_type"]) for d in decided if d.get("doc_type")}
    seen_desc = {(d.get("kind") == "disqualifier", _norm(d.get("description", ""))) for d in decided}
    out = []
    for r in rows:
        dq = r["kind"] == "disqualifier"
        if (r.get("doc_type") and (dq, r["doc_type"]) in seen_types) or (dq, _norm(r["description"])) in seen_desc:
            continue
        out.append(r)
    for i, r in enumerate(out):
        r["sort_order"] = i
    return out


def ai_fields_payload(checked: dict, summary: dict, res: llm.LLMResult, files: list[dict], file_ids: list[str]) -> dict:
    return {
        "fields": {k: checked[k] for k in FIELD_KEYS},
        "summary": summary,
        "files": [{"n": i, "id": fid, "name": f["name"]} for i, (f, fid) in enumerate(zip(files, file_ids), start=1)],
        "provider": res.provider, "model": res.model,
        "tokens": {"input": res.input_tokens, "output": res.output_tokens}, "seconds": round(res.seconds, 1),
    }


def process_ai(sb, job: dict) -> None:
    tid, company = job["id"], job["company_id"]
    log.info("AI extraction for tender %s (attempt %s)", tid, job["ai_attempts"])
    try:
        files, file_ids = load_files(sb, tid)
        if not files:
            raise NoReadableFiles("No readable PDFs for this tender. Upload or retry the files first.")
        checked, summary, res = extract_fields(files)
        rows = requirement_rows(checked, tid, company, file_ids)
        decided = (sb.table("requirements").select("kind, description, doc_type")
                   .eq("tender_id", tid).eq("confirmed", True).execute().data) or []
        skipped = len(rows)
        rows = drop_already_decided(rows, decided)
        skipped -= len(rows)

        # Replace earlier unconfirmed AI rows; keep anything a person confirmed or added.
        (sb.table("requirements").delete().eq("tender_id", tid).eq("confirmed", False)
           .in_("added_by", ["ai", "keyword_check"]).execute())
        if rows:
            sb.table("requirements").insert(rows).execute()
        sb.table("tenders").update({
            "ai_status": "done", "ai_error": None, "ai_model": f"{res.provider}/{res.model}",
            "ai_extracted_at": datetime.now(timezone.utc).isoformat(), "ai_file_ids": file_ids,
            "ai_fields": ai_fields_payload(checked, summary, res, files, file_ids),
        }).eq("id", tid).execute()
        log.info("AI done for %s: %s new requirements (%s already confirmed), %s low confidence, %.1fs",
                 tid, len(rows), skipped, summary["low_confidence"], res.seconds)
    except Exception as e:  # noqa: BLE001 — record any failure on the tender
        kind = error_kind(e)
        msg = str(e) if isinstance(e, (ValueError, llm.LLMError)) else f"AI extraction failed ({e.__class__.__name__}): {e}"
        log.exception("AI failed for %s (%s)", tid, kind)
        # ai_error keeps the technical detail; the app shows a plain message chosen by ai_error_kind.
        sb.table("tenders").update({"ai_status": "failed", "ai_error": msg[:500], "ai_error_kind": kind}).eq("id", tid).execute()
        if kind == "account":
            alert_admin(sb, msg)
