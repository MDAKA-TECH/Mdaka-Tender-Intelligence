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
             "match": [r"\breference"], "maps_to": None, "mandatory": None, "core": True, "pages": p["cond"],
             "quote": "A current list of references where similar work was undertaken should be supplied."},
            {"id": "letterhead", "name": "Quote on company letterhead showing the VAT registration number",
             "match": [r"letterhead", r"\bvat\b"], "maps_to": None, "mandatory": None, "core": False, "pages": p["cond"],
             "quote": "Quotes should be on the company letterhead, indicating the VAT registration number."},
            {"id": "cvs", "name": "Evidence of the resource's qualifications and experience (CV, certificates)",
             "match": [r"\bcv", r"qualification", r"curriculum"], "maps_to": None, "mandatory": None, "core": False, "pages": p["reqs"],
             "quote": "Evidence of relevant qualifications and professional experience." if n == "906"
             else "Demonstrated experience delivering data engineering solutions in Azure-based environments."},
            {"id": "experience", "name": "Background and experience form (two largest contracts)",
             "match": [r"background", r"experience", r"contracts"], "maps_to": None, "mandatory": None, "core": False, "pages": p["pricing"],
             "quote": "LIST THE TWO LARGEST CONTRACTS / ASSIGNMENTS BY YOUR FIRM"},
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


# ---------------------------------------------------------------- Transport Economic Regulator (4-file pack)
TER_FILES = ["RFQ_Background Checks and Psychometric Assessments.pdf", "SBD 4 -Annexure A (1).pdf",
             "SBD 6.1 IN TERMS OF PPR2022-  OCT - 2024.pdf", "Supplier POPIA Consent.pdf"]


def key_ter() -> dict:
    return {
        "name": "TER_RFQ2026_27_03 (4 files)", "slug": "TER_RFQ2026_27_03", "files": TER_FILES,
        "fields": {
            "reference_no": {"value": "TER/RFQ2026/27/03", "pages": [1], "quote": "RFQ TER/RFQ2026/27/03", "must": True},
            "issuing_entity": {"contains_any": ["transport economic regulator", "ports regulator"], "pages": [1, 2, 10, 11, [4, 1]],
                               "value": "Transport Economic Regulator (Ports Regulator)", "quote": "FOR THE TRANSPORT ECONOMIC REGULATOR", "must": True},
            "description": {"contains_any": ["background", "psychometric"], "pages": [1, 2], "value": "Background checks and Hogan psychometric assessments",
                            "quote": "CONDUCT BACKGROUND CHECKS, STATUTORY DISQUALIFICATION VERIFICATION AND HOGAN EXECUTIVE", "must": True},
            "closing": {"value": {"date": "2026-10-23", "time": "11:00"}, "pages": [1], "quote": "CLOSING DATE & TIME 23 October 2026 at 11H00",
                        "must": True, "critical": True},
            "submission": {"value": {"method": "email", "address": "quotations@portsregulator.org"}, "pages": [1],
                           "quote": "Bidders must submit responses via e-mail at: quotations@portsregulator.org", "must": True},
            "briefing": {"expect": "not_found", "accept_none": True, "note": "Printed as 'BRIEFING SESSION N/A'.", "must": True},
            "evaluation": {"value": {"preference_system": "80/20", "functionality_threshold": None}, "pages": [8, [3, 1], [3, 2]],
                           "quote": "Price will be composed of 80%, and specific goals will be composed of 20%.",
                           "note": "No literal '80/20' in the RFQ; the SBD 6.1 form lists both systems."},
            "validity_days": {"value": 90, "pages": [10], "quote": "remain open for acceptance by the Ports Regulator for a period of 90 days"},
            "contact": {"value": {"email": "quotations@portsregulator.org"}, "pages": [1, 10],
                        "quote": "All enquiries relating to this RFQ should be sent via email: quotations@portsregulator.org"},
            "query_deadline": {"expect": "not_found", "note": "No last date for questions."},
            "pricing_format": {"contains_any": ["vat", "unit", "rate", "per candidate"], "pages": [8, 9, 10, 11],
                               "value": "Unit rates per service in the pricing schedule, inclusive of VAT",
                               "quote": "Bidders' price quotations must be inclusive of all applicable taxes (including VAT)."},
        },
        "returnables": [
            {"id": "sbd61", "name": "SBD 6.1 preference points claim form", "match": [r"sbd ?6\.?1", r"preference point"],
             "maps_to": None, "mandatory": True, "core": True, "pages": [7, 11, [3, 1], [3, 2], [3, 3], [3, 4], [3, 5]], "shared": True,
             "quote": "The SBD forms must be completed, signed by the authorised company representative."},
            {"id": "sbd4", "name": "SBD 4 bidder's disclosure (declaration of interest)", "match": [r"sbd ?4", r"disclosure", r"declaration of interest"],
             "maps_to": None, "mandatory": True, "core": True, "pages": [7, 11, [2, 1], [2, 2], [2, 3]], "shared": True,
             "quote": "Declaration of Interest (SBD 4and 6.1)"},
            {"id": "pbsa", "name": "Proof of PBSA or SABSA registration", "match": [r"pbsa", r"sabsa", r"screen\w* association"],
             "maps_to": None, "mandatory": True, "core": True, "pages": [7, 11],
             "quote": "The bidder must be registered with the Professional Background Screening Association (PBSA)"},
            {"id": "references", "name": "Three signed client reference letters (2 screening, 1 psychometric, not older than 5 years)",
             "match": [r"\breference"], "maps_to": None, "mandatory": True, "core": True, "pages": [7, 11],
             "quote": "three (3) signed and dated client reference letters, on client letterhead, not older than five (5) years"},
            {"id": "csd", "name": "Proof of CSD registration (CSD report)", "match": [r"\bcsd\b", r"central supplier"],
             "maps_to": "csd_report", "mandatory": True, "core": True, "pages": [7, 11],
             "quote": "The bidder must submit proof of registration on CSD (Central Supplier Database)."},
            {"id": "bbbee", "name": "B-BBEE certificate or sworn affidavit (for specific-goal points)", "match": [r"b-?bbee", r"affidavit"],
             "maps_to": "bbbee", "mandatory": None, "core": True, "pages": [8, [3, 1], [3, 2], [3, 3], [3, 4], [3, 5]],
             "quote": "Valid B-BBEE certificate or sworn affidavit", "note": "Needed to claim the 20 points, so mandatory can be either."},
            {"id": "pricing", "name": "Quotation on company letterhead with the priced schedule (unit rates, VAT incl.)",
             "match": [r"pric", r"quot", r"letterhead", r"\brate"], "maps_to": None, "mandatory": True, "core": True, "pages": [8, 9, 10, 11],
             "quote": "Quotation on a company letterhead"},
            {"id": "popia", "name": "Supplier POPIA consent form", "match": [r"popia", r"consent", r"personal information"],
             "maps_to": None, "mandatory": None, "core": False, "pages": [[4, 1], [4, 2], [4, 3]], "quote": "SUPPLIER CONSENT: PROTECTION OF PERSONAL INFORMATION ACT"},
            {"id": "cover", "name": "RFQ cover page with supplier details, signed", "match": [r"supplier (name|detail|information)", r"cover", r"rfq (form|document)"],
             "maps_to": None, "mandatory": None, "core": False, "pages": [1], "quote": "SIGNATURE OF BIDDER"},
        ],
        "disqualifiers": [
            {"id": "late", "name": "Late or incomplete submission", "match": [r"late", r"incomplete", r"after the closing"], "core": True,
             "pages": [1], "quote": "Late and incomplete submissions will invalidate the quote submitted."},
            {"id": "mandatory", "name": "Not meeting the Phase 2 mandatory requirements (references, PBSA/SABSA)",
             "match": [r"mandatory", r"phase 2", r"pbsa", r"sabsa", r"reference"], "core": True, "pages": [7],
             "quote": "Failure by the bidder to provide the mandatory requirements as indicated above will lead to bidder's proposal not being considered"},
            {"id": "defaulters", "name": "Listed on the Register for Tender Defaulters / Restricted Suppliers", "match": [r"defaulter", r"restricted"],
             "core": False, "pages": [[2, 1]], "quote": "Register for Tender Defaulters"},
        ],
        "special_requirements_note": "Expected (not scored): PBSA/SABSA registration; Hogan accreditation; 12-month as-and-when contract.",
    }


# ---------------------------------------------------------------- Limpopo DPWRI (56 pages, fully scanned)
LDP_FILE = "Office Accommodation LDPWRI-P 20675 Soekmekaar.pdf"


def key_ldpwri() -> dict:
    sbd_pages = [1, 2, 3, 4, 5, 6, 7, 8, 10, 13, 14, 15, 16, 17]
    return {
        "name": "LDPWRI-P_20675 (scanned, 56 pages)", "slug": "LDPWRI-P_20675", "files": [LDP_FILE],
        "fields": {
            "reference_no": {"value": "LDPWRI-P/20675", "pages": [3, 1], "quote": "Bid Number... LDPWRI-P/20675", "must": True,
                             "note": "The bid number box on page 1 is blank in the scan; it's printed on the SBD 3.2 form."},
            "issuing_entity": {"contains_any": ["public works", "limpopo"], "pages": [1, 9, 18],
                               "value": "Limpopo Department of Public Works, Roads and Infrastructure",
                               "quote": "REQUIREMENTS OF LIMPOPO DEPARTMENT OF PUBLIC WORKS ROADS & INFRASTRUCTURE", "must": True},
            "description": {"contains_any": ["office accom"], "pages": [1, 9, 18], "value": "Office accommodation in Soekmekaar for 9 years 11 months",
                            "quote": "OFFICE ACCOMODATION FOR THE DEPARTMENT OF ECONOMIC DEVELOPMENT", "must": True},
            "closing": {"value": {"date": "2026-10-30", "time": "11:00"}, "pages": [3], "quote": "Closing Time 11:00 ... Closing date...30 OCTOBER 2026",
                        "must": True, "critical": True, "note": "Only printed on the SBD 3.2 pricing form (page 3)."},
            "submission": {"value": {"method": "tender_box", "address": "blaauwberg"}, "pages": [1],
                           "quote": "BID RESPONSE DOCUMENTS MAY BE DEPOSITED IN THE BID BOX SITUATED AT", "must": True},
            "briefing": {"value": {"compulsory": True, "date": "2026-10-20", "time": "11:30"}, "pages": [55],
                         "quote": "There will be a compulsory briefing session for this bid.", "must": True,
                         "note": "Venue: Capricorn District Office. Only on page 55 of 56."},
            "evaluation": {"value": {"preference_system": "90/10", "functionality_threshold": None}, "pages": [13, 14, 15, 16, 9, 10, 11],
                           "quote": "The 90/10 preference point system will be applicable in this tender."},
            "validity_days": {"expect": "not_found", "note": "No validity period is stated (only the generic GCC wording)."},
            "contact": {"value": {"email": ["malapanehs@dpw.limpopo.gov.za", "baloyimt@dpw.limpopo.gov.za"]}, "pages": [1],
                        "quote": "Malapanehs@dpw.limpopo.gov.za"},
            "query_deadline": {"expect": "not_found", "note": "No last date for questions."},
            "pricing_format": {"contains_any": ["sbd 3.2", "non-firm", "non firm", "taxes", "vat", "figures", "words"], "pages": [3, 4, 10],
                               "value": "SBD 3.2 non-firm price schedule, all applicable taxes included; prices in figures and words on the Form of Offer",
                               "quote": "PRICING SCHEDULE — NON-FIRM PRICES"},
        },
        "returnables": [
            {"id": "sbd1", "name": "SBD 1 invitation to bid, completed", "match": [r"sbd ?1\b", r"invitation to bid", r"sbd forms"],
             "maps_to": None, "mandatory": True, "core": True, "pages": sbd_pages, "shared": True,
             "quote": "Fully completed SBD forms (SBDs 1, 3.2, 4, 6.1& GCC)"},
            {"id": "sbd32", "name": "SBD 3.2 pricing schedule (non-firm prices)", "match": [r"sbd ?3\.?2", r"pricing schedule", r"sbd forms"],
             "maps_to": None, "mandatory": True, "core": True, "pages": sbd_pages, "shared": True, "quote": "PRICING SCHEDULE — NON-FIRM PRICES"},
            {"id": "sbd4", "name": "SBD 4 bidder's disclosure", "match": [r"sbd ?4", r"disclosure", r"sbd forms"],
             "maps_to": None, "mandatory": True, "core": True, "pages": sbd_pages, "shared": True, "quote": "BIDDER’S DISCLOSURE"},
            {"id": "sbd61", "name": "SBD 6.1 preference points claim form", "match": [r"sbd ?6\.?1", r"preference point", r"sbd forms"],
             "maps_to": None, "mandatory": True, "core": True, "pages": sbd_pages, "shared": True,
             "quote": "PREFERENCE POINTS CLAIM FORM IN TERMS OF THE PREFERENTIAL"},
            {"id": "gcc", "name": "Signed acceptance of the General Conditions of Contract (GCC)", "match": [r"\bgcc\b", r"general conditions"],
             "maps_to": None, "mandatory": True, "core": True, "pages": [10, 54, 2], "shared": True,
             "quote": "FAILURE TO ACCPET ALL THE GENERAL CONDITIONS OF CONTRACT AS SPECIFIED IN THE ABOVE WILL RESULT IN DISQUALIFICATION"},
            {"id": "csd", "name": "CSD registration", "match": [r"\bcsd\b", r"central supplier"], "maps_to": "csd_report", "mandatory": True,
             "core": True, "pages": [10, 31, 2, 1], "quote": "The Central Supplier Database (CSD) report must be submitted."},
            {"id": "authority", "name": "Proof of authority to sign (company resolution / power of attorney)",
             "match": [r"resolution", r"power of attorney", r"authori[sz]"], "maps_to": None, "mandatory": True, "core": True, "pages": [2, 10, 32],
             "quote": "(Proof of authority must be submitted e.g. company resolution)"},
            {"id": "architect", "name": "Architect's plans, sketches/drawings and signed architect's certificate (grading, lettable area)",
             "match": [r"architect", r"sketch", r"drawing"], "maps_to": None, "mandatory": True, "core": True, "pages": [31, 32],
             "quote": "Architect's plans of the building must be included in the tender."},
            {"id": "maintenance", "name": "Maintenance plan", "match": [r"maintenance plan"], "maps_to": None, "mandatory": True,
             "core": True, "pages": [32], "quote": "The tenderer must include a Maintenance Plan in the tender."},
            {"id": "sapoa", "name": "Proof of SAPOA registration", "match": [r"sapoa", r"property owners"], "maps_to": None,
             "mandatory": True, "core": True, "pages": [32],
             "quote": "Proof of Registration with the Head of Department of the South African Property Owners Association (SAPOA) must be submitted."},
            {"id": "offer", "name": "Form of Offer, signed, prices in figures and words", "match": [r"form of offer"],
             "maps_to": None, "mandatory": True, "core": True, "pages": [10], "quote": "Form of Offer must be duly signed and completed."},
            {"id": "briefing_reg", "name": "Signed attendance register of the compulsory briefing", "match": [r"attendance", r"briefing"],
             "maps_to": None, "mandatory": None, "core": False, "pages": [55],
             "quote": "Bidders will be provided with the attendance register and must sign it",
             "note": "Signed at the briefing, not submitted with the bid, so it's a bonus item."},
            {"id": "tax", "name": "Tax compliance status (TCS) PIN or certificate", "match": [r"\btax", r"\btcs\b"], "maps_to": "tax_compliance",
             "mandatory": None, "core": True, "pages": [1, 2],
             "quote": "BIDDERS ARE REQUIRED TO SUBMIT THEIR UNIQUE PERSONAL IDENTIFICATION NUMBER (PIN) ISSUED BY SARS"},
            {"id": "building", "name": "Approved building plans and OHS / building-regulations compliance certificate",
             "match": [r"building plan", r"\bohs\b", r"occupational", r"building regulations", r"compliance certificate"],
             "maps_to": None, "mandatory": None, "core": True, "pages": [9, 18], "quote": "Approved Building Plans and OHS"},
            {"id": "lease", "name": "Signed offer to purchase or valid lease contract (existing building)",
             "match": [r"offer to purchase", r"lease"], "maps_to": None, "mandatory": None, "core": True, "pages": [9],
             "quote": "Signed Offer to Purchase or Valid Lease Contract"},
            {"id": "goals", "name": "Specific-goal proofs (disability certificate, CSD, utility bill / proof of residence)",
             "match": [r"disabilit", r"utility", r"residence", r"specific goal"], "maps_to": None, "mandatory": None, "core": False,
             "pages": [16], "quote": "Attach Municipal Utility Bills or Lease"},
            {"id": "green", "name": "Green Star certificate or green-building commitment letter (functionality)",
             "match": [r"green", r"commitment letter"], "maps_to": None, "mandatory": None, "core": False, "pages": [11, 12],
             "quote": "Availability of any green star rating certificate"},
            {"id": "spec", "name": "Initialled minimum-requirements specification", "match": [r"specification", r"initial"],
             "maps_to": None, "mandatory": None, "core": False, "pages": [18], "quote": "must be initialed and submitted along with all other documents"},
        ],
        "disqualifiers": [
            {"id": "sketches", "name": "Not submitting sketches and drawings of the offered accommodation", "match": [r"sketch", r"drawing"],
             "core": True, "pages": [31], "quote": "Failure to submit such sketches will disqualify tenderers."},
            {"id": "admin", "name": "Not submitting the completed SBD forms / not registered on CSD", "match": [r"sbd", r"non-submission", r"\bcsd\b"],
             "core": True, "pages": [10], "quote": "Non-submission of the following will lead to bids being disqualified"},
            {"id": "gcc", "name": "Not accepting all the General Conditions of Contract", "match": [r"\bgcc\b", r"general conditions of contract"], "core": True,
             "pages": [54], "quote": "WILL RESULT IN DISQUALIFICATION OF YOUR BID"},
            {"id": "correction", "name": "Correction fluid, pencil or unsigned price amendments", "match": [r"correction", r"pencil", r"amendment", r"tipp"],
             "core": True, "pages": [10], "quote": "Usage of correction fluid"},
            {"id": "late", "name": "Late bids", "match": [r"late", r"after the closing", r"stipulated time"], "core": True, "pages": [2],
             "quote": "LATE BIDS WILL NOT BE ACCEPTED FOR CONSIDERATION."},
            {"id": "authority_d", "name": "No written proof of authority to offer the building", "match": [r"authori[sz]"], "core": False,
             "pages": [32], "quote": "will not be considered"},
            {"id": "vat", "name": "VAT included by a non-VAT vendor", "match": [r"\bvat\b"], "core": False, "pages": [10],
             "quote": "Inclusion of VAT by non-VAT vendors"},
            {"id": "functionality", "name": "Failing the minimum functionality", "match": [r"functionality"], "core": False, "pages": [11],
             "quote": "Failure to meet minimum functionality may result in the tenderer being disqualified."},
            {"id": "state", "name": "Bidder or directors in the service of the state", "match": [r"service of the state", r"state employ", r"employed by the state"],
             "core": False, "pages": [2, 6], "quote": "NO BIDS WILL BE CONSIDERED FROM PERSONS IN THE SERVICE OF THE STATE"},
            {"id": "defaulters", "name": "Listed as a tender defaulter / restricted supplier", "match": [r"defaulter", r"restricted"], "core": False,
             "pages": [6], "quote": "Register for Tender Defaulters"},
        ],
        "special_requirements_note": "Expected (not scored): 9 years 11 months lease; 5 parking bays; UPS/solar; 2,500-5,000 L water back-up; NBR/OHS compliance.",
    }


def _pg(pages) -> str:
    return ", ".join(str(p) if isinstance(p, int) else f"file {p[0]} p.{p[1]}" for p in pages) or "-"


def review_md(keys: list[dict]) -> str:
    out = ["# Answer key: please check against the PDFs", "",
           "Tick each row once you've confirmed it in the PDF. Fix anything wrong in `make_keys.py` and re-run it.", ""]
    for k in keys:
        files = k.get("files") or [k["file"]]
        out += [f"## {k.get('name') or files[0]}", ""] + ([f"Files: " + "; ".join(f"{i}. {f}" for i, f in enumerate(files, 1)), ""] if len(files) > 1 else []) + [ "| ✓ | Field | Expected | Page(s) | Quote |", "| --- | --- | --- | --- | --- |"]
        for name, f in k["fields"].items():
            exp = "NOT FOUND" if f.get("expect") == "not_found" else json.dumps(f.get("value"), ensure_ascii=False)
            tag = " **(must-have)**" if f.get("must") else ""
            note = f" <br>_{f['note']}_" if f.get("note") else ""
            out.append(f"| [ ] | {name}{tag} | {exp}{note} | {_pg(f.get('pages', []))} | {f.get('quote', '-')} |")
        out += ["", "**Documents to submit**", "", "| ✓ | Document | Mandatory | Vault | Counts | Page(s) | Quote |",
                "| --- | --- | --- | --- | --- | --- | --- |"]
        for r in k["returnables"]:
            m = {True: "yes", False: "no", None: "either"}[r["mandatory"]]
            note = f" <br>_{r['note']}_" if r.get("note") else ""
            out.append(f"| [ ] | {r['name']}{note} | {m} | {r['maps_to'] or '-'} | {'core' if r['core'] else 'bonus'} | "
                       f"{_pg(r['pages'])} | {r['quote']} |")
        out += ["", "**Disqualification conditions**", "", "| ✓ | Condition | Counts | Page(s) | Quote |", "| --- | --- | --- | --- | --- |"]
        for d in k["disqualifiers"]:
            out.append(f"| [ ] | {d['name']} | {'core' if d['core'] else 'bonus'} | {_pg(d['pages'])} | {d['quote']} |")
        out += ["", f"_{k['special_requirements_note']}_", ""]
    return "\n".join(out)


if __name__ == "__main__":
    keys = [key("906"), key("907"), key_ter(), key_ldpwri()]
    names = []
    for k in keys:
        name = (k.get("slug") or k["file"].replace(".pdf", "")) + ".json"
        (HERE / name).write_text(json.dumps(k, indent=2, ensure_ascii=False), encoding="utf-8")
        names.append(name)
    (HERE / "REVIEW.md").write_text(review_md(keys), encoding="utf-8")
    print("Wrote", ", ".join(names), "and REVIEW.md")
