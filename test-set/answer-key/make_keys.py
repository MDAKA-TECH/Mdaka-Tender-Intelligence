"""Builds the answer-key JSON for the two Parliament RFQs (same template, different pages).
Edit the values here, re-run `python make_keys.py`, and the JSON + REVIEW.md are regenerated.

Answer-key conventions
- fields: expected value + the pages where it may be cited. expect "not_found" = the document
  doesn't state it, so any value the AI gives is a hallucination.
- returnables / disqualifiers: `match` = regexes tried against the AI's item name (one-to-one).
  core = counts towards the score. Non-core items are fine to find but not penalised if missed.
  mandatory: true / false, or null when the wording is soft ("should") and either answer is OK.
"""
import json
from pathlib import Path

HERE = Path(__file__).parent

# Page numbers differ: RFQ 907's conditions start on page 1, so later sections are one page earlier.
PAGES = {
    "906": dict(cover=1, goals=[2], cond=[2], cond2=[2, 3], hdi=[3], supplier=[4], tor=[5], kpa=[6], reqs=[7], pricing=[8], decl=[9, 10]),
    "907": dict(cover=1, goals=[1], cond=[2], cond2=[2], hdi=[2], supplier=[3], tor=[4], kpa=[5], reqs=[6], pricing=[7], decl=[8, 9]),
}
ROLE = {"906": ("Data Analyst", "data analyst", "NQF Level 7 qualification and at least five years' data analysis experience"),
        "907": ("Data Engineer", "data engineer", "Bachelor's degree and three to five years or more data engineering experience")}


def key(n: str) -> dict:
    p = PAGES[n]
    role, role_lc, req = ROLE[n]
    return {
        "file": f"RFQ_{n}_2026.pdf",
        "fields": {
            "reference_no": {"value": f"RFQ {n}/2026", "pages": [p["cover"]], "quote": f"Quotation Reference Number: RFQ {n}/2026", "must": True},
            "issuing_entity": {"contains_any": ["parliament"], "pages": [p["cover"], *p["cond"], *p["tor"], *p["supplier"], *p["decl"]],
                               "value": "Parliament of the Republic of South Africa", "quote": "Parliament of the Republic of South Africa seeks to appoint", "must": True},
            "description": {"contains_any": [role_lc], "pages": [p["cover"], *p["tor"]], "value": f"{role} services",
                            "quote": f"Product/Service Requested: {role.upper()} SERVICES", "must": True},
            "closing": {"value": {"date": "2026-10-12", "time": None}, "pages": [p["cover"]], "quote": "Closing Date: 12/10/2026",
                        "note": "No closing time is printed. The time must come back null.", "must": True, "critical": True},
            "submission": {"value": {"method": "email", "address": "avokwana@parliament.gov.za"}, "pages": p["cond"],
                           "quote": "The quotation must be emailed to avokwana@parliament.gov.za", "must": True},
            "briefing": {"expect": "not_found", "note": "No briefing session is mentioned.", "must": True},
            "evaluation": {"value": {"preference_system": "80/20", "functionality_threshold": None}, "pages": p["goals"],
                           "quote": "Quotations will be evaluated on 80 /20 preference point system."},
            "validity_days": {"expect": "not_found", "note": "No bid validity period is stated."},
            "contact": {"value": {"email": "avokwana@parliament.gov.za"}, "pages": [*p["cond"], p["cover"]],
                        "quote": "Further information regarding this quote may be obtained from to avokwana@parliament.gov.za"},
            "query_deadline": {"expect": "not_found", "note": "No closing date for questions is stated."},
            "pricing_format": {"contains_any": ["hour", "vat"], "pages": [p["cover"], *p["cond"], *p["tor"], *p["pricing"]],
                               "value": "Hourly rate, VAT inclusive, in South African currency",
                               "quote": "must clearly indicate the hourly rate applicable to the services"},
        },
        "returnables": [
            # Order matters: specific patterns first, so the one-to-one matching doesn't steal items.
            {"id": "goals_docs", "name": "Supporting documents for the specific goals claimed (ID / CSD / CK, medical certificate, turnover confirmation)",
             "match": [r"specific goal", r"preference", r"\bhdi\b", r"\brdp\b", r"supporting doc", r"\bck\b", r"medical", r"turnover"],
             "maps_to": None, "mandatory": None, "core": True, "pages": [*p["goals"], *p["cond"]],
             "quote": "All suppliers must submit valid tax pin and all supporting documents as per the specific goals table.",
             "note": "Only needed to claim preference points, so mandatory can be either."},
            {"id": "declaration", "name": "Declaration of interest form, signed and stamped by a Commissioner of Oaths",
             "match": [r"declaration of interest", r"sbd ?4", r"bidder.?s disclosure", r"commissioner of oaths"],
             "maps_to": None, "mandatory": True, "core": True, "pages": [*p["cond"], *p["decl"]],
             "quote": "the declaration of interest form must be filled in, signed, stamped by a Commissioner of Oaths"},
            {"id": "tax", "name": "Valid tax compliance status PIN",
             "match": [r"tax"], "maps_to": "tax_compliance", "mandatory": True, "core": True, "pages": [*p["cond"], *p["supplier"]],
             "quote": "All suppliers must submit valid tax pin"},
            {"id": "csd", "name": "Registration on the Central Supplier Database (CSD)",
             "match": [r"\bcsd\b", r"central supplier"], "maps_to": "csd_report", "mandatory": None, "core": True,
             "pages": [*p["cond"], *p["supplier"]],
             "quote": "All suppliers responding to quotation should be registered on Central Supplier Database (CSD)",
             "note": "Says 'should be registered', so mandatory can be either."},
            {"id": "bank", "name": "Bank confirmation letter or cancelled cheque",
             "match": [r"bank", r"cheque"], "maps_to": "bank_letter", "mandatory": None, "core": True, "pages": p["supplier"],
             "quote": "Attach a bank confirmation letter or cancelled cheque to confirm bank account number"},
            {"id": "pricing", "name": "Priced quotation / pricing schedule with hourly rate (VAT inclusive)",
             "match": [r"pric", r"hourly", r"\brate\b", r"cost"], "maps_to": None, "mandatory": True, "core": True,
             "pages": [p["cover"], *p["cond"], *p["tor"], *p["pricing"]],
             "quote": "The quotation submitted by the service provider must clearly indicate the hourly rate"},
            {"id": "rfq_doc", "name": "RFQ document completed in full (including the supplier information form)",
             "match": [r"rfq document", r"supplier information", r"completed in full", r"rfq form"], "maps_to": None, "mandatory": True,
             "core": True, "pages": [*p["cond"], *p["supplier"]],
             "quote": "The RFQ document must be completed in full"},
            {"id": "references", "name": "Current list of references for similar work",
             "match": [r"reference"], "maps_to": None, "mandatory": None, "core": True, "pages": p["cond"],
             "quote": "A current list of references where similar work was undertaken should be supplied."},
            {"id": "letterhead", "name": "Quote on company letterhead showing the VAT registration number",
             "match": [r"letterhead", r"\bvat\b"], "maps_to": None, "mandatory": None, "core": False, "pages": p["cond"],
             "quote": "Quotes should be on the company letterhead, indicating the VAT registration number."},
            {"id": "experience", "name": "Background and experience form (two largest contracts)",
             "match": [r"background", r"experience", r"contracts"], "maps_to": None, "mandatory": None, "core": False, "pages": p["pricing"],
             "quote": "LIST THE TWO LARGEST CONTRACTS / ASSIGNMENTS BY YOUR FIRM"},
            {"id": "cvs", "name": "Evidence of the resource's qualifications and experience (CV, certificates)",
             "match": [r"\bcv", r"qualification", r"curriculum"], "maps_to": None, "mandatory": None, "core": False, "pages": p["reqs"],
             "quote": "Evidence of relevant qualifications and professional experience." if n == "906"
             else "Demonstrated experience delivering data engineering solutions in Azure-based environments."},
        ],
        "disqualifiers": [
            {"id": "missing_docs", "name": "Not submitting all required documents",
             "match": [r"(fail|not).*(submit|document)", r"missing", r"all documents"], "core": True, "pages": p["cond"],
             "quote": "Failure to submit all documents as required might result in disqualification."},
            {"id": "late", "name": "Quotation received after the closing date",
             "match": [r"late", r"after the closing", r"closing date"], "core": True, "pages": p["cond"],
             "quote": "All quotations received after the closing date will not be accepted."},
            {"id": "conflict", "name": "Bidder (or its directors) is an MP, Cabinet member, councillor or state employee",
             "match": [r"member of parliament", r"\bmp", r"councillor", r"state", r"conflict"], "core": False, "pages": [*p["cond"], *p["decl"]],
             "quote": "Parliament cannot award contracts to provide goods and services to a Member of Parliament"},
        ],
        "special_requirements_note": f"Expected (not scored): {req}; 12-month enabling contract, ad-hoc basis.",
    }


def review_md(keys: list[dict]) -> str:
    out = ["# Answer key: please check against the PDFs", "",
           "Tick each row once you've confirmed it in the PDF. Fix anything wrong in `make_keys.py` and re-run it.", ""]
    for k in keys:
        out += [f"## {k['file']}", "", "| ✓ | Field | Expected | Page(s) | Quote |", "| --- | --- | --- | --- | --- |"]
        for name, f in k["fields"].items():
            exp = "NOT FOUND" if f.get("expect") == "not_found" else json.dumps(f.get("value"), ensure_ascii=False)
            tag = " **(must-have)**" if f.get("must") else ""
            note = f" <br>_{f['note']}_" if f.get("note") else ""
            out.append(f"| [ ] | {name}{tag} | {exp}{note} | {', '.join(map(str, f.get('pages', []))) or '-'} | {f.get('quote', '-')} |")
        out += ["", "**Documents to submit**", "", "| ✓ | Document | Mandatory | Vault | Counts | Page(s) | Quote |",
                "| --- | --- | --- | --- | --- | --- | --- |"]
        for r in k["returnables"]:
            m = {True: "yes", False: "no", None: "either"}[r["mandatory"]]
            note = f" <br>_{r['note']}_" if r.get("note") else ""
            out.append(f"| [ ] | {r['name']}{note} | {m} | {r['maps_to'] or '-'} | {'core' if r['core'] else 'bonus'} | "
                       f"{', '.join(map(str, r['pages']))} | {r['quote']} |")
        out += ["", "**Disqualification conditions**", "", "| ✓ | Condition | Counts | Page(s) | Quote |", "| --- | --- | --- | --- | --- |"]
        for d in k["disqualifiers"]:
            out.append(f"| [ ] | {d['name']} | {'core' if d['core'] else 'bonus'} | {', '.join(map(str, d['pages']))} | {d['quote']} |")
        out += ["", f"_{k['special_requirements_note']}_", ""]
    return "\n".join(out)


if __name__ == "__main__":
    keys = [key("906"), key("907")]
    for k in keys:
        (HERE / k["file"].replace(".pdf", ".json")).write_text(json.dumps(k, indent=2, ensure_ascii=False), encoding="utf-8")
    (HERE / "REVIEW.md").write_text(review_md(keys), encoding="utf-8")
    print("Wrote", ", ".join(k["file"].replace(".pdf", ".json") for k in keys), "and REVIEW.md")
