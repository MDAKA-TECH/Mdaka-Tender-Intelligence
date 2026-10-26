"""Tests for the week 3 pipeline without calling a real model.

  cd worker && python -m pytest -q tests   (or: python tests/test_pipeline.py)

Builds model-style answers from the answer key, plays them through the 'fixture' provider,
then checks the verifier and the scorer catch the mistakes that matter.
"""
from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import evaluate  # noqa: E402
import verify  # noqa: E402
from ai_extract import extract_fields, files_from_pdfs  # noqa: E402
from fields import SCHEMA  # noqa: E402

TEST_SET = HERE.parent.parent / "test-set"


def nf() -> dict:
    return {"status": "not_found", "value": None, "file": None, "page": None, "quote": None, "confidence": None}


def _fp(ref) -> tuple[int, int]:
    return (1, ref) if isinstance(ref, int) else (ref[0], ref[1])


def found(value, page, quote, conf="high") -> dict:
    f, p = _fp(page)
    return {"status": "found", "value": value, "file": f, "page": p, "quote": quote, "confidence": conf}


def perfect_answer(key: dict) -> dict:
    """What a flawless model would return for this tender."""
    f = key["fields"]
    def val(name):
        e = f[name]
        if e.get("expect") == "not_found":
            return nf()
        v = e["value"]
        if name == "contact":
            v = {"name": None, "email": v["email"][0] if isinstance(v["email"], list) else v["email"], "phone": None}
        if name == "submission" and "@" not in v["address"]:
            v = {**v, "address": "Corner Blaauwberg & River Street, Ladanna"}
        if name == "briefing":
            v = {**v, "venue": "Capricorn District Office"}
        if name in ("issuing_entity", "description", "pricing_format") and "contains_any" in e:
            v = e["value"]
        if name == "closing":
            v = dict(v)
        return found(v, e["pages"][0], e["quote"])
    out = {name: val(name) for name in f}
    out["returnables"] = [{
        "name": r["name"], "category": "other", "sbd_number": None, "maps_to": r["maps_to"],
        "mandatory": True if r["mandatory"] is None else r["mandatory"], "conditions": None,
        "file": _fp(r["pages"][0])[0], "page": _fp(r["pages"][0])[1], "quote": r["quote"], "confidence": "high",
    } for r in key["returnables"]]
    out["disqualifiers"] = [{"condition": d["name"], "file": _fp(d["pages"][0])[0], "page": _fp(d["pages"][0])[1],
                             "quote": d["quote"], "confidence": "high"} for d in key["disqualifiers"]]
    out["special_requirements"] = []
    return out


def run_fixture(answer: dict, pdf) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as t:
        json.dump(answer, t)
    os.environ.update(LLM_PROVIDER="fixture", LLM_FIXTURE=t.name)
    checked, _s, _r = extract_fields(files_from_pdfs(pdf if isinstance(pdf, list) else [pdf]))
    os.unlink(t.name)
    return checked


def load_key(n: str) -> dict:
    return json.loads((TEST_SET / "answer-key" / f"RFQ_{n}_2026.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- tests

def test_schema_is_strict_compatible():
    """OpenAI strict mode: every object lists all its keys as required and forbids extras."""
    def walk(s, path="root"):
        if isinstance(s, dict):
            if s.get("type") == "object":
                assert s.get("additionalProperties") is False, path
                assert set(s["required"]) == set(s["properties"]), path
            for k, v in s.items():
                walk(v, f"{path}.{k}")
        elif isinstance(s, list):
            for i, v in enumerate(s):
                walk(v, f"{path}[{i}]")
    walk(SCHEMA)


def test_perfect_answer_passes_both_tenders():
    for n in ("906", "907"):
        key = load_key(n)
        checked = run_fixture(perfect_answer(key), str(TEST_SET / key["file"]))
        assert all(it["verified"] for it in checked["returnables"]), n
        r = evaluate.score_tender(key, checked)
        assert r["passed"], (n, [row for row in r["rows"] if row[2] not in ("correct", "skipped")])


def test_perfect_answer_passes_multi_file_pack():
    key = json.loads((TEST_SET / "answer-key" / "TER_RFQ2026_27_03.json").read_text(encoding="utf-8"))
    pdfs = [str(TEST_SET / f) for f in evaluate.key_files(key)]
    checked = run_fixture(perfect_answer(key), pdfs)
    unverified = [r["name"] for r in checked["returnables"] if not r["verified"]]
    assert not unverified, unverified
    r = evaluate.score_tender(key, checked)
    assert r["passed"], [row for row in r["rows"] if row[2] not in ("correct", "skipped")]
    # A briefing reported as 'not applicable' (no date, not compulsory) counts as right for "N/A".
    a = perfect_answer(key)
    a["briefing"] = found({"compulsory": False, "date": None, "time": None, "venue": None}, 1, "BRIEFING SESSION N/A")
    verdict = {n: v for _g, n, v, _d, _c in evaluate.score_tender(key, run_fixture(a, pdfs))["rows"]}
    assert verdict["briefing"] == "correct"


def test_shared_item_covers_several_forms():
    key = {"returnables": [
        {"id": "sbd4", "match": [r"sbd ?4", r"sbd forms"], "shared": True},
        {"id": "sbd61", "match": [r"sbd ?6\.?1", r"sbd forms"], "shared": True},
        {"id": "csd", "match": [r"csd"]}]}
    got = [{"name": "Fully completed SBD forms (SBD 1, 3.2, 4, 6.1)"}, {"name": "CSD registration"}]
    m = evaluate.match_items(key["returnables"], got, "name")
    assert m == {"sbd4": 0, "sbd61": 0, "csd": 1}


def test_safety_net_adds_missed_vault_documents():
    files = [{"name": "t.pdf", "pages": [
        {"page": 1, "text": "SUPPLIER TAX COMPLIANCE STATUS\nIS THE ENTITY LIABLE FOR TAX?"},
        {"page": 2, "text": "2.4 BIDDERS MAY ALSO SUBMIT A PRINTED TCS CERTIFICATE TOGETHER WITH THE BID.\nAll applicable taxes included."}]}]
    out = {"returnables": [{"name": "CSD report", "maps_to": "csd_report"}]}
    verify.safety_net(out, files)
    added = [r for r in out["returnables"] if r.get("added_by") == "keyword_check"]
    assert [r["maps_to"] for r in added] == ["tax_compliance"]           # CSD already listed; no B-BBEE/CIPC mentioned
    assert added[0]["page"] == 2 and added[0]["confidence"] == "low"     # prefers the line that states a requirement
    out2 = {"returnables": [{"name": "Tax PIN", "maps_to": "tax_compliance"}]}
    verify.safety_net(out2, files)
    assert len(out2["returnables"]) == 1                                 # nothing added when the AI already has it


def test_typical_mistakes_fail_the_gate():
    key = load_key("906")
    bad = perfect_answer(key)
    bad["closing"]["value"]["time"] = "11:00"                       # invented closing time, high confidence
    bad["returnables"] = [r for r in bad["returnables"] if "Declaration" not in r["name"]]  # missed form (keyword net catches it)
    bad["returnables"] = [r for r in bad["returnables"] if "references" not in r["name"]]   # missed requirement (no net for this)
    bad["validity_days"] = found(90, 2, "Bids must remain valid for 90 days", "high")       # made-up field and quote
    bad["returnables"][1]["page"] = 7                                # tax PIN cited on the wrong page (quote is on p.2)
    checked = run_fixture(bad, str(TEST_SET / key["file"]))

    # Verifier: fake quote → unverified + low; wrong page → corrected to the real page.
    assert checked["validity_days"]["verified"] is False and checked["validity_days"]["confidence"] == "low"
    tax = next(r for r in checked["returnables"] if "tax" in r["name"].lower())
    assert tax["page"] == 2 and tax["verified"] and any("Page corrected" in n for n in tax["notes"])

    r = evaluate.score_tender(key, checked)
    verdict = {name: v for _g, name, v, _d, _c in r["rows"]}
    assert verdict["closing"] == "wrong"          # invented time at high confidence is a hard fail
    assert verdict["declaration"] == "flagged"   # AI missed it; the keyword safety net added it at low confidence
    assert verdict["references"] == "missed"
    assert verdict["validity_days"] == "flagged"  # made-up value, but the verifier flagged it low
    assert not r["critical_ok"] and not r["passed"]


def test_low_confidence_wrong_closing_is_flagged_not_failed():
    key = load_key("907")
    a = perfect_answer(key)
    a["closing"]["value"]["date"] = "2026-12-10"   # day/month swapped
    a["closing"]["confidence"] = "low"
    r = evaluate.score_tender(key, run_fixture(a, str(TEST_SET / key["file"])))
    verdict = {name: v for _g, name, v, _d, _c in r["rows"]}
    assert verdict["closing"] == "flagged" and r["critical_ok"]


def test_schema_rejects_malformed_output():
    key = load_key("906")
    a = perfect_answer(key)
    del a["returnables"][0]["mandatory"]
    try:
        verify.check(a, files_from_pdfs([str(TEST_SET / key["file"])]))
    except ValueError as e:
        assert "mandatory" in str(e)
    else:
        raise AssertionError("malformed output was accepted")


def test_quote_matching_tolerates_layout():
    page = "▪  The quotation must be emailed to\n   avokwana@parliament.gov.za"
    assert verify.quote_score("The quotation must be emailed to avokwana@parliament.gov.za", page) == 1.0
    assert verify.quote_score("Bids must remain valid for 90 days", page) < verify.FUZZY_MIN
    # Table cells come out interleaved with neighbouring columns.
    table = "4. Tenderers must supply the following documents\nBlack 6 Identity Document/ CSD/CK document\nwhen claiming preference points"
    assert verify.quote_score("Tenderers must supply the following documents when claiming preference points", table) >= verify.FUZZY_MIN
    # Words run together by the model or the PDF.
    assert verify.quote_score("indicating the VATregistration number of the supplier", "indicating the VAT registration number of the supplier") >= verify.FUZZY_MIN


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("PASS", name)
            except Exception as e:  # noqa: BLE001
                fails += 1
                print("FAIL", name, repr(e))
    sys.exit(1 if fails else 0)
