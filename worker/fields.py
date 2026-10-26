"""What the AI must return for a tender: a fixed JSON schema, plus the prompt that asks for it.

Every value carries its source (file + page), a short verbatim quote and a confidence level.
A field the document doesn't contain comes back as status "not_found", never as a guess.
The schema is "strict-mode" shaped (every key required, nulls allowed) so OpenAI's strict JSON
schema, Anthropic tool input and our own validator all accept the same definition.
"""
from __future__ import annotations

from typing import Any

DOC_TYPES = ["tax_compliance", "csd_report", "bbbee", "cipc_registration", "director_ids", "bank_letter", "coid"]
CATEGORIES = ["form", "declaration", "registration", "certificate", "financial", "technical", "pricing", "company_info", "other"]


def _nullable(t: str | dict) -> dict:
    if isinstance(t, str):
        return {"type": [t, "null"]}
    return {"anyOf": [t, {"type": "null"}]}


def _obj(props: dict[str, Any]) -> dict:
    return {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}


SOURCE = {
    "file": {"type": "integer", "description": "1-based index of the file the value came from (see <file n=...>)."},
    "page": {"type": "integer", "description": "1-based page number within that file."},
    "quote": {"type": "string", "description": "Exact words copied from that page that prove the value, max ~30 words."},
    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
}


def field(value_schema: dict, desc: str) -> dict:
    """A single tender-level field: found with a value and source, or not_found."""
    return {
        **_obj({
            "status": {"type": "string", "enum": ["found", "not_found"]},
            "value": _nullable(value_schema),
            "file": _nullable("integer"),
            "page": _nullable("integer"),
            "quote": _nullable("string"),
            "confidence": _nullable({"type": "string", "enum": ["high", "medium", "low"]}),
        }),
        "description": desc,
    }


def item(props: dict[str, Any], desc: str) -> dict:
    return {"type": "array", "description": desc, "items": _obj({**props, **SOURCE})}


SCHEMA: dict = _obj({
    "reference_no": field({"type": "string"}, "Tender / RFQ / bid number exactly as printed, e.g. 'RFQ 906/2026'."),
    "issuing_entity": field({"type": "string"}, "Organisation issuing the tender (department, municipality, SOE, Parliament...)."),
    "description": field({"type": "string"}, "Short description of the goods or services, under 15 words."),
    "closing": field(
        _obj({
            "date": {"type": "string", "description": "YYYY-MM-DD"},
            "time": {"type": ["string", "null"], "description": "HH:MM 24-hour, or null if no time is stated. Never assume a time."},
        }),
        "Closing / submission deadline.",
    ),
    "submission": field(
        _obj({
            "method": {"type": "string", "enum": ["email", "etenders_upload", "tender_box", "hand_delivery", "courier", "online_portal", "other"]},
            "address": {"type": "string", "description": "Email address, portal URL or physical tender box address."},
        }),
        "How and where bids must be submitted.",
    ),
    "briefing": field(
        _obj({
            "compulsory": {"type": ["boolean", "null"]},
            "date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
            "time": {"type": ["string", "null"], "description": "HH:MM"},
            "venue": {"type": ["string", "null"], "description": "Venue or online meeting link."},
        }),
        "Briefing session / site meeting. not_found if the document doesn't mention one.",
    ),
    "evaluation": field(
        _obj({
            "preference_system": {"type": ["string", "null"], "enum": ["80/20", "90/10", "other", None]},
            "functionality_threshold": {"type": ["number", "null"], "description": "Minimum functionality score to proceed, if any."},
        }),
        "Evaluation method.",
    ),
    "validity_days": field({"type": "integer"}, "Bid validity period in days."),
    "contact": field(
        _obj({"name": {"type": ["string", "null"]}, "email": {"type": ["string", "null"]}, "phone": {"type": ["string", "null"]}}),
        "Contact person for enquiries.",
    ),
    "query_deadline": field({"type": "string"}, "Last date for questions, YYYY-MM-DD."),
    "pricing_format": field({"type": "string"}, "How prices must be given (pricing schedule, hourly rate, VAT inclusive...)."),
    "returnables": item(
        {
            "name": {"type": "string", "description": "Plain name, e.g. 'Declaration of interest form (SBD 4)'."},
            "category": {"type": "string", "enum": CATEGORIES},
            "sbd_number": {"type": ["string", "null"], "description": "Only if the document itself names it, e.g. 'SBD 4'. Otherwise null."},
            "maps_to": {"type": ["string", "null"], "enum": [*DOC_TYPES, None], "description": "Company vault document that satisfies it, if any."},
            "mandatory": {"type": "boolean", "description": "true if the document says it must be submitted or omission disqualifies."},
            "conditions": {"type": ["string", "null"], "description": "Signing, certification, stamping, validity or 'only if claiming points' conditions."},
        },
        "Every document, form, certificate or proof the bidder must submit with the bid. One entry per distinct document.",
    ),
    "disqualifiers": item(
        {"condition": {"type": "string", "description": "What causes rejection or disqualification, in plain words."}},
        "Explicit grounds for disqualification or non-acceptance (late bids, missing documents, unsigned forms...).",
    ),
    "special_requirements": item(
        {"requirement": {"type": "string"}},
        "Other conditions a bidder must meet: CIDB grading, professional registration, minimum qualifications or experience of key staff, local content, contract period.",
    ),
})

SYSTEM_PROMPT = """You extract bid-compliance facts from South African public-sector tender and RFQ documents.

Rules:
- Use only what the documents say. If a field isn't stated, return status "not_found" with null value, file, page, quote and confidence. Never guess, never fill in "usual" values (e.g. don't assume an 11:00 closing time).
- For every value give the file number and page number where it appears, and a short quote copied exactly from that page (max ~30 words, no paraphrasing, no "..." inside the quote).
- confidence: "high" = stated explicitly and unambiguously; "medium" = stated but needs interpretation or is spread over pages; "low" = inferred or unclear.
- Returnables: list every distinct document the bidder must submit, including forms that are part of the pack (declarations, supplier information forms, pricing schedules), certificates, registrations and supporting evidence. Name SBD/MBD forms by what they are; set sbd_number only if the document prints the number. List pricing schedules / price forms as their own item, separate from the quotation or letterhead requirement. Common forms: SBD 1 invitation to bid, SBD 3.x pricing schedules, SBD 4 bidder's disclosure / declaration of interest, SBD 6.1 preference points claim. A form may be required without its number being printed.
- maps_to: tax_compliance (SARS tax compliance status / TCS PIN), csd_report (CSD registration / supplier number), bbbee (B-BBEE certificate or sworn affidavit), cipc_registration (company registration documents), director_ids (ID copies of directors/owners), bank_letter (bank confirmation letter), coid (COID letter of good standing). Otherwise null.
- Read every page before answering. Long tenders add requirements in annexures, specification and condition tables, "important tender conditions" lists and declarations near the end (e.g. acceptance of the General Conditions of Contract). Include all of them.
- Documents needed only for one option (e.g. existing building vs new construction, or only when claiming points) are still returnables: list them and state the option in conditions.
- Disqualifiers: one entry for every distinct statement that a bid will be disqualified, invalid, rejected, not considered or not accepted, or is "non-compliant". This includes lists of administrative requirements ("non-submission of the following will lead to disqualification") and refusing to accept the GCC.
- mandatory = true when the text says must / shall / required / will be disqualified; false for should / may / advantageous, unless omission is said to cause disqualification.
- Dates as YYYY-MM-DD. South African documents write dates as DD/MM/YYYY.
"""


def build_user_prompt(files: list[dict]) -> str:
    """files: [{"name": str, "pages": [{"page": int, "text": str}, ...]}, ...]"""
    parts = ["Extract the tender facts from these documents.\n"]
    for i, f in enumerate(files, start=1):
        parts.append(f'<file n="{i}" name="{f["name"]}">')
        for p in f["pages"]:
            parts.append(f'<page n="{p["page"]}">\n{p["text"]}\n</page>')
        parts.append("</file>")
    return "\n".join(parts)
