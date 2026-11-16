"""Answers a person's question about one tender, from that tender's extracted text only.

The answer comes back with quotes and page references; every quote is checked against the real page
text (verify._locate), so a made-up quote is marked unverified instead of shown as a source.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import llm
from ai_job import alert_admin, error_kind, load_files
from verify import FUZZY_MIN, _locate

log = logging.getLogger("worker.qa")

QA_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["found", "answer", "citations"],
    "properties": {
        "found": {"type": "boolean", "description": "true if the documents answer the question"},
        "answer": {"type": "string", "description": "Plain-English answer, at most about 120 words"},
        "citations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["file", "page", "quote"],
                "properties": {
                    "file": {"type": "integer", "description": "file number n from <file n=...>"},
                    "page": {"type": "integer", "description": "page number n from <page n=...>"},
                    "quote": {"type": "string", "description": "exact words copied from that page, 5 to 40 words"},
                },
            },
        },
    },
}

QA_SYSTEM = """You answer questions about a South African public-sector tender (RFQ or bid) for a small supplier.
Use ONLY the tender documents provided. Never use outside knowledge about the tender, the client or the law.
- If the documents answer the question: found=true, a short plain-English answer (at most about 120 words),
  and 1 to 4 citations, each an exact quote copied word for word from the cited file and page.
- If they don't: found=false, and say plainly that the documents don't state it (and what they do say nearby, if
  anything useful). Never guess.
- Don't give legal advice and never say a bid is compliant or will succeed.
- Dates as written in the document. Use South African terms (SBD forms, CSD, B-BBEE, CIDB) as the document does."""


def build_prompt(question: str, files: list[dict]) -> str:
    parts = [f"Question: {question}\n", "Tender documents:"]
    for i, f in enumerate(files, start=1):
        parts.append(f'<file n="{i}" name="{f["name"]}">')
        for p in f["pages"]:
            parts.append(f'<page n="{p["page"]}">\n{p["text"]}\n</page>')
        parts.append("</file>")
    parts.append(f"\nQuestion again: {question}")
    return "\n".join(parts)


def check_citations(data: dict, files: list[dict], file_ids: list[str]) -> list[dict]:
    """Keep citations whose quote really is in the documents (moving them to the right page if needed)."""
    out, seen = [], set()
    for c in data.get("citations") or []:
        quote = (c.get("quote") or "").strip()
        if not quote:
            continue
        f, p, score = _locate(quote, files, c.get("file"), c.get("page"))
        verified = bool(f and score >= FUZZY_MIN)
        if not verified:
            f, p = c.get("file"), c.get("page")
        key = (f, p, quote[:40])
        if key in seen:
            continue
        seen.add(key)
        fid = file_ids[f - 1] if isinstance(f, int) and 1 <= f <= len(file_ids) else None
        out.append({"file_id": fid, "page": p if fid else None, "quote": quote[:400], "verified": verified})
    return out


def process_question(sb, job: dict) -> None:
    qid, tid = job["id"], job["tender_id"]
    log.info("Answering a question on tender %s (attempt %s)", tid, job["attempts"])
    try:
        files, file_ids = load_files(sb, tid)
        if not files:
            raise ValueError("This tender has no read documents yet. Upload the PDFs and wait for them to be read.")
        res = llm.call(build_prompt(job["question"], files), system=QA_SYSTEM, schema=QA_SCHEMA, name="answer_question")
        data = res.data if isinstance(res.data, dict) else {}
        answer = str(data.get("answer") or "").strip()
        if not answer:
            raise llm.LLMError("The model returned an empty answer.")
        citations = check_citations(data, files, file_ids)
        found = bool(data.get("found"))
        sb.table("tender_questions").update({
            "status": "done", "answer": answer[:3000], "found": found, "citations": citations,
            "error": None, "error_kind": None, "model": f"{res.provider}/{res.model}",
            "answered_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", qid).execute()
        log.info("Answered question %s (%s citations, %.1fs)", qid, len(citations), res.seconds)
    except Exception as e:  # noqa: BLE001
        kind = error_kind(e)
        if isinstance(e, ValueError) and "no read documents" in str(e):
            kind = "input"
        log.exception("Question %s failed (%s)", qid, kind)
        sb.table("tender_questions").update({"status": "failed", "error": str(e)[:500], "error_kind": kind}).eq("id", qid).execute()
        if kind == "account":
            alert_admin(sb, str(e))
