"""Worker AI step with an in-memory stand-in for Supabase (no network, no model).

  cd worker && python tests/test_ai_job.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import ai_job  # noqa: E402
import evaluate  # noqa: E402
from ai_extract import files_from_pdfs  # noqa: E402
from test_pipeline import TEST_SET, perfect_answer  # noqa: E402


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload, self.order_by = db, table, [], "select", None, None

    def select(self, _cols):
        self.op = "select"; return self
    def update(self, data):
        self.op, self.payload = "update", data; return self
    def insert(self, rows):
        self.op, self.payload = "insert", rows; return self
    def delete(self):
        self.op = "delete"; return self
    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val); return self
    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals); return self
    def order(self, col):
        self.order_by = col; return self

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "select":
            if self.order_by:
                match.sort(key=lambda r: r[self.order_by])
            return type("R", (), {"data": [dict(r) for r in match]})
        if self.op == "update":
            for r in match:
                r.update(self.payload)
        elif self.op == "insert":
            rows.extend(dict(r) for r in self.payload)
        elif self.op == "delete":
            self.db[self.table] = [r for r in rows if r not in match]
        return type("R", (), {"data": []})


class FakeSB:
    def __init__(self):
        self.db: dict[str, list[dict]] = {}

    def table(self, name):
        return Query(self.db, name)


def setup_ter(sb: FakeSB) -> dict:
    key = json.loads((TEST_SET / "answer-key" / "TER_RFQ2026_27_03.json").read_text(encoding="utf-8"))
    files = files_from_pdfs([str(TEST_SET / f) for f in evaluate.key_files(key)])
    sb.db["tenders"] = [{"id": "T1", "company_id": "C1", "ai_status": "running"}]
    # Uploaded in pack order; a failed file must not shift the numbering.
    sb.db["tender_files"] = [
        {"id": f"F{i}", "tender_id": "T1", "status": "done", "file_name": f["name"], "extracted_text": f["pages"], "created_at": f"2026-10-26T08:0{i}"}
        for i, f in enumerate(files, start=1)
    ] + [{"id": "FX", "tender_id": "T1", "status": "failed", "file_name": "broken.pdf", "extracted_text": None, "created_at": "2026-10-26T08:05"}]
    # An earlier run left an unconfirmed AI row and a confirmed one; a person added one too.
    sb.db["requirements"] = [
        {"tender_id": "T1", "description": "old AI row", "added_by": "ai", "confirmed": False},
        {"tender_id": "T1", "description": "confirmed AI row", "added_by": "ai", "confirmed": True},
        {"tender_id": "T1", "description": "person's own row", "added_by": "user", "confirmed": False},
    ]
    return key


def use_fixture(answer: dict) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as t:
        json.dump(answer, t)
    os.environ.update(LLM_PROVIDER="fixture", LLM_FIXTURE=t.name)


def test_saves_results_and_maps_files():
    sb = FakeSB()
    key = setup_ter(sb)
    use_fixture(perfect_answer(key))
    ai_job.process_ai(sb, {"id": "T1", "company_id": "C1", "ai_attempts": 1})

    t = sb.db["tenders"][0]
    assert t["ai_status"] == "done", t.get("ai_error")
    assert t["ai_file_ids"] == ["F1", "F2", "F3", "F4"]
    assert t["ai_fields"]["fields"]["closing"]["value"] == {"date": "2026-10-23", "time": "11:00"}
    assert [f["name"] for f in t["ai_fields"]["files"]][1] == "SBD 4 -Annexure A (1).pdf"

    reqs = sb.db["requirements"]
    descs = [r["description"] for r in reqs]
    assert "old AI row" not in descs and "confirmed AI row" in descs and "person's own row" in descs
    new = [r for r in reqs if r.get("sort_order") is not None]
    assert all(r["confirmed"] is False for r in new)
    popia = next(r for r in new if "POPIA" in r["description"])
    assert popia["source_file_id"] == "F4"               # file 4 in the AI's answer → the 4th uploaded file
    kinds = {r["kind"] for r in new}
    assert {"disqualifier", "document"} <= kinds
    assert all(r["company_id"] == "C1" and r["tender_id"] == "T1" for r in new)


def test_rerun_skips_confirmed_and_dismissed_items():
    sb = FakeSB()
    key = setup_ter(sb)
    sb.db["requirements"] = [
        # Confirmed with the person's own wording, and the vault type set.
        {"tender_id": "T1", "kind": "certification", "description": "CSD report (print fresh)", "doc_type": "csd_report",
         "added_by": "ai", "confirmed": True, "status": "todo"},
        # Marked "not required" by the person.
        {"tender_id": "T1", "kind": "document", "description": "Supplier POPIA consent form", "doc_type": None,
         "added_by": "ai", "confirmed": True, "status": "not_applicable"},
    ]
    use_fixture(perfect_answer(key))
    ai_job.process_ai(sb, {"id": "T1", "company_id": "C1", "ai_attempts": 1})
    new = [r for r in sb.db["requirements"] if r.get("sort_order") is not None]
    assert not any(r.get("doc_type") == "csd_report" for r in new)          # same vault type → skipped
    assert not any("POPIA" in r["description"] for r in new)                # same description → skipped
    assert len(sb.db["requirements"]) == 2 + len(new)                       # the person's rows are untouched
    assert [r["sort_order"] for r in new] == list(range(len(new)))


def test_failure_is_recorded():
    sb = FakeSB()
    setup_ter(sb)
    os.environ.update(LLM_PROVIDER="fixture", LLM_FIXTURE="/nonexistent/answer.json")
    ai_job.process_ai(sb, {"id": "T1", "company_id": "C1", "ai_attempts": 1})
    t = sb.db["tenders"][0]
    assert t["ai_status"] == "failed" and t["ai_error"]
    assert len(sb.db["requirements"]) == 3               # nothing deleted when the run fails


def test_no_readable_files():
    sb = FakeSB()
    sb.db["tenders"] = [{"id": "T9", "company_id": "C1", "ai_status": "running"}]
    sb.db["tender_files"] = [{"id": "FX", "tender_id": "T9", "status": "failed", "created_at": "x"}]
    ai_job.process_ai(sb, {"id": "T9", "company_id": "C1", "ai_attempts": 1})
    assert sb.db["tenders"][0]["ai_status"] == "failed"
    assert "No readable PDFs" in sb.db["tenders"][0]["ai_error"]


if __name__ == "__main__":
    import logging
    logging.disable(logging.CRITICAL)
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
