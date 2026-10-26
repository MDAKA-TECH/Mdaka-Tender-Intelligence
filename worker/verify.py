"""Check the model's answer against the actual page text before anyone relies on it.

1. Validate against the JSON schema (anything malformed is rejected).
2. Every quote must really appear on the page it cites. If it's on a different page the page
   is corrected; if it can't be found anywhere the value is marked unverified and low confidence.
3. Basic sanity checks (real dates, consistent not_found fields).
The result keeps the model's values but adds `verified` and `notes` to every field and item.
"""
from __future__ import annotations

import copy
import re
from datetime import date
from difflib import SequenceMatcher

from jsonschema import Draft202012Validator

from fields import SCHEMA

LIST_KEYS = ("returnables", "disqualifiers", "special_requirements")
FIELD_KEYS = [k for k in SCHEMA["properties"] if k not in LIST_KEYS]
FUZZY_MIN = 0.85   # share of the quote that must match one stretch of the page text
_validator = Draft202012Validator(SCHEMA)


def schema_errors(data: dict) -> list[str]:
    return [f"{'/'.join(map(str, e.path)) or '(root)'}: {e.message}" for e in _validator.iter_errors(data)][:20]


_TRANS = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})


def norm(s: str) -> str:
    s = s.translate(_TRANS).lower()
    return re.sub(r"[^a-z0-9@./%]+", " ", s).strip()


TABLE_MATCH = 0.9   # score given to a quote whose words appear in order but interleaved (table layout)


def _in_order(words: list[str], page_words: list[str]) -> bool:
    """True if `words` appear in order in page_words, with other words allowed in between but
    within a window of 4x the quote length. Tables come out of PDFs with their columns
    interleaved, so a sentence from one cell is split up by text from the next cells."""
    n = len(words)
    if n < 4:
        return False  # too short to tell apart from coincidence
    window = n * 4
    for start, w in enumerate(page_words):
        if w != words[0]:
            continue
        i, j = 1, start + 1
        while i < n and j < len(page_words) and j - start < window:
            if page_words[j] == words[i]:
                i += 1
            j += 1
        if i == n:
            return True
    return False


def quote_score(quote: str, page_text: str) -> float:
    """1.0 if every part of the quote appears verbatim, TABLE_MATCH if it appears in order across a
    table layout, else the best partial match ratio."""
    parts = [norm(p) for p in re.split(r"\.\.\.|…", quote) if norm(p)]
    if not parts:
        return 0.0
    page = norm(page_text)
    page_words = page.split()
    page_nospace = page.replace(" ", "")
    scores = []
    for q in parts:
        if q in page:
            scores.append(1.0)
            continue
        if len(q) >= 20 and q.replace(" ", "") in page_nospace:  # words run together or split ("VATregistration")
            scores.append(0.95)
            continue
        if _in_order(q.split(), page_words):
            scores.append(TABLE_MATCH)
            continue
        m = SequenceMatcher(None, page, q, autojunk=False).find_longest_match(0, len(page), 0, len(q))
        scores.append(m.size / len(q))
    return min(scores)


def _locate(quote: str, files: list[dict], file_no: int | None, page_no: int | None) -> tuple[int | None, int | None, float]:
    """Find where a quote really is. Returns (file, page, score), preferring the cited page."""
    def page_text(f: int, p: int) -> str | None:
        if 1 <= f <= len(files):
            for pg in files[f - 1]["pages"]:
                if pg["page"] == p:
                    return pg["text"]
        return None

    if file_no and page_no:
        t = page_text(file_no, page_no)
        if t is not None:
            s = quote_score(quote, t)
            if s >= FUZZY_MIN:
                return file_no, page_no, s
    best = (None, None, 0.0)
    for fi, f in enumerate(files, start=1):
        for pg in f["pages"]:
            s = quote_score(quote, pg["text"])
            if s > best[2]:
                best = (fi, pg["page"], s)
    return best


def _cap(conf: str | None, cap: str) -> str:
    order = ["low", "medium", "high"]
    if conf not in order:
        return cap
    return order[min(order.index(conf), order.index(cap))]


def _check_source(obj: dict, files: list[dict]) -> None:
    notes: list[str] = []
    quote = (obj.get("quote") or "").strip()
    if not quote:
        obj["verified"] = False
        obj["confidence"] = "low"
        notes.append("No quote given.")
    else:
        f, p, s = _locate(quote, files, obj.get("file"), obj.get("page"))
        if s >= FUZZY_MIN:
            obj["verified"] = True
            if s < 1.0:
                notes.append("Quote matched across a table or broken layout.")
            if (f, p) != (obj.get("file"), obj.get("page")):
                notes.append(f"Page corrected from {obj.get('file')}:{obj.get('page')} to {f}:{p}.")
                obj["file"], obj["page"] = f, p
                obj["confidence"] = _cap(obj.get("confidence"), "medium")
        else:
            obj["verified"] = False
            obj["confidence"] = "low"
            notes.append("Quote not found in the document. Check this by hand.")
    obj["notes"] = notes


def _valid_iso(d: str | None) -> bool:
    if not d:
        return False
    try:
        date.fromisoformat(d)
        return True
    except ValueError:
        return False


def check(data: dict, files: list[dict]) -> dict:
    """Returns a verified copy. Raises ValueError if the output doesn't match the schema."""
    errs = schema_errors(data)
    if errs:
        raise ValueError("Model output did not match the schema: " + "; ".join(errs[:5]))
    out = copy.deepcopy(data)

    for k in FIELD_KEYS:
        fld = out[k]
        if fld["status"] == "not_found":
            fld.update(value=None, file=None, page=None, quote=None, confidence=None, verified=None, notes=[])
            continue
        if fld["value"] is None:
            fld.update(status="not_found", file=None, page=None, quote=None, confidence=None, verified=None,
                       notes=["Marked found but had no value."])
            continue
        _check_source(fld, files)

    # Sanity checks on values the checklist and reminders depend on.
    c = out["closing"]
    if c["status"] == "found":
        if not _valid_iso(c["value"].get("date")):
            c["confidence"] = "low"
            c["notes"].append("Closing date is not a valid date.")
        t = c["value"].get("time")
        if t and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", t):
            c["confidence"] = "low"
            c["notes"].append("Closing time is not a valid HH:MM time.")
    b = out["briefing"]
    if b["status"] == "found" and b["value"].get("date") and not _valid_iso(b["value"]["date"]):
        b["confidence"] = "low"
        b["notes"].append("Briefing date is not a valid date.")

    for k in LIST_KEYS:
        for it in out[k]:
            _check_source(it, files)
    safety_net(out, files)
    return out


# ---------------------------------------------------------------- keyword safety net
# The standard company-vault documents are asked for in predictable words. If the text asks for
# one and the AI didn't list it, add it (low confidence) so a person confirms it instead of it
# silently going missing. This doesn't depend on the model, so it catches run-to-run misses.
VAULT_KEYWORDS = {
    "tax_compliance": ("Tax compliance status (TCS) PIN", "registration",
                       r"tax compliance status|\btcs\b|tax clearance|unique personal identification number \(pin\) issued by sars"),
    "csd_report": ("Central Supplier Database (CSD) registration / report", "registration",
                   r"central supplier database|\bcsd (report|registration|number|no)\b|registered on (the )?csd"),
    "bbbee": ("B-BBEE certificate or sworn affidavit", "certificate",
              r"b-?bbee (certificate|status level certificate)|bbbee certificate|sworn affidavit"),
    "cipc_registration": ("CIPC company registration documents", "registration",
                          r"\bcipc\b|company registration certificate|\bcor ?14\.3\b"),
    "bank_letter": ("Bank confirmation letter", "financial", r"bank confirmation letter|cancelled cheque"),
    "coid": ("COID letter of good standing", "certificate", r"\bcoid\b|letter of good standing"),
}


_REQUIRE = re.compile(r"\b(must|shall|submit\w*|attach\w*|required|provide|proof|enclose)\b", re.I)


def _find_line(pattern: str, files: list[dict]) -> tuple[int, int, str] | None:
    """First line that names the document and sounds like a requirement; else the first mention."""
    rx = re.compile(pattern, re.I)
    first = None
    for fi, f in enumerate(files, start=1):
        for pg in f["pages"]:
            for line in pg["text"].splitlines():
                if rx.search(line):
                    hit = (fi, pg["page"], " ".join(line.split())[:200])
                    if _REQUIRE.search(line):
                        return hit
                    first = first or hit
    return first


# Standard forms found in almost every SA tender pack: (name, category, sbd, text pattern, already-listed pattern).
FORM_KEYWORDS = [
    ("Pricing schedule / price form", "pricing", None,
     r"pricing schedule|price schedule|bill of quantities|sbd ?3\.\d", r"pric|bill of quantities|sbd ?3\.|rate"),
    ("SBD 4 bidder's disclosure / declaration of interest", "declaration", "SBD 4",
     r"sbd ?4\b|bidder.?s disclosure|declaration of interest", r"sbd ?4\b|disclosure|declaration of interest"),
    ("SBD 6.1 preference points claim form", "form", "SBD 6.1",
     r"sbd ?6\.1|preference points claim form", r"sbd ?6\.1|preference point"),
]


def _add(out: dict, hit: tuple[int, int, str], name: str, category: str, maps_to: str | None, sbd: str | None) -> None:
    fi, page, quote = hit
    out["returnables"].append({
        "name": name, "category": category, "sbd_number": sbd, "maps_to": maps_to,
        "mandatory": True, "conditions": None, "file": fi, "page": page, "quote": quote,
        "confidence": "low", "verified": True, "added_by": "keyword_check",
        "notes": ["Added by keyword check: the document mentions this but the AI didn't list it. Confirm whether it's required."],
    })


def safety_net(out: dict, files: list[dict]) -> None:
    covered = {r.get("maps_to") for r in out["returnables"]}
    names = " | ".join(f"{r['name']} {r.get('sbd_number') or ''}" for r in out["returnables"])
    for name, category, sbd, pattern, listed in FORM_KEYWORDS:
        if re.search(listed, names, re.I):
            continue
        hit = _find_line(pattern, files)
        if hit:
            _add(out, hit, name, category, None, sbd)
    for doc_type, (name, category, pattern) in VAULT_KEYWORDS.items():
        if doc_type in covered:
            continue
        hit = _find_line(pattern, files)
        if hit:
            _add(out, hit, name, category, doc_type, None)


def summary(checked: dict) -> dict:
    """Counts for logs and the UI."""
    fields = [checked[k] for k in FIELD_KEYS if checked[k]["status"] == "found"]
    items = [it for k in LIST_KEYS for it in checked[k]]
    allv = fields + items
    return {
        "fields_found": len(fields),
        "fields_not_found": len(FIELD_KEYS) - len(fields),
        "returnables": len(checked["returnables"]),
        "mandatory_returnables": sum(1 for r in checked["returnables"] if r["mandatory"]),
        "unverified": sum(1 for v in allv if v.get("verified") is False),
        "low_confidence": sum(1 for v in allv if v.get("confidence") == "low"),
    }
