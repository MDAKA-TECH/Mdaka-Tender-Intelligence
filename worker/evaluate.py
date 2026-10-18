"""Week 3 gate: run the AI on every tender in test-set/ and score it against the answer key.

  python evaluate.py                 # run the model on all keyed tenders, then score
  python evaluate.py --from DIR      # re-score saved outputs in DIR without calling the model

Pass bar (from the MVP scope doc):
  1. Closing date and mandatory documents: each correct, or flagged low confidence. None wrong at
     medium/high confidence, none missed.
  2. All other must-have and should-have fields: 90% or more correct.
Outputs are saved to test-set/results/<timestamp>/ so runs can be compared.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent / "test-set"
KEYS = ROOT / "answer-key"


def _norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9@./]+", " ", (s or "").lower()).strip()


def _on_page(got: dict, pages: list[int]) -> bool:
    return got.get("file") == 1 and got.get("page") in pages


# ---------------------------------------------------------------- field scoring

def score_field(name: str, exp: dict, got: dict) -> tuple[str, str]:
    """Returns (verdict, detail). verdict: correct | wrong | flagged (wrong but low confidence)."""
    low = got.get("confidence") == "low"

    def wrong(why: str) -> tuple[str, str]:
        return ("flagged" if low else "wrong"), why

    if exp.get("expect") == "not_found":
        return ("correct", "not found, as expected") if got["status"] == "not_found" else wrong(f"invented a value: {json.dumps(got['value'])}")
    if got["status"] == "not_found":
        return "wrong", "missed (returned not_found)"

    v = got["value"]
    want = exp.get("value")
    if name == "reference_no":
        ok = _norm(v) == _norm(want)
    elif name in ("issuing_entity", "description", "pricing_format"):
        ok = any(w in _norm(v) for w in exp["contains_any"])
    elif name == "closing":
        ok = v.get("date") == want["date"] and (v.get("time") or None) == want["time"]
        if not ok:
            return wrong(f"got {v.get('date')} {v.get('time')}, expected {want['date']} {want['time']}")
    elif name == "submission":
        ok = v.get("method") == want["method"] and _norm(want["address"]) in _norm(v.get("address"))
    elif name == "evaluation":
        ok = v.get("preference_system") == want["preference_system"]
    elif name == "contact":
        ok = _norm(want["email"]) in _norm(v.get("email"))
    else:
        ok = v == want
    if not ok:
        return wrong(f"got {json.dumps(v, ensure_ascii=False)}")
    if not _on_page(got, exp["pages"]):
        return wrong(f"right value, wrong page ({got.get('page')}; expected {exp['pages']})")
    return "correct", "ok"


# ---------------------------------------------------------------- list scoring (one-to-one matching)

def match_items(expected: list[dict], got: list[dict], text_key: str) -> dict[str, int | None]:
    used: set[int] = set()
    out: dict[str, int | None] = {}
    for e in expected:
        pats = [re.compile(p, re.I) for p in e["match"]]
        idx = next((i for i, g in enumerate(got) if i not in used and any(p.search(g[text_key]) for p in pats)), None)
        if idx is not None:
            used.add(idx)
        out[e["id"]] = idx
    return out


def score_returnable(e: dict, g: dict | None) -> tuple[str, str]:
    if g is None:
        return "missed", "not listed"
    low = g.get("confidence") == "low"
    problems = []
    if e["mandatory"] is not None and g["mandatory"] != e["mandatory"]:
        problems.append(f"mandatory={g['mandatory']}")
    if e["maps_to"] and g.get("maps_to") != e["maps_to"]:
        problems.append(f"maps_to={g.get('maps_to')}")
    if not _on_page(g, e["pages"]):
        problems.append(f"page {g.get('page')}")
    if not problems:
        return "correct", g["name"]
    return ("flagged" if low else "wrong"), f"{g['name']} ({', '.join(problems)})"


# ---------------------------------------------------------------- report

def score_tender(key: dict, out: dict) -> dict:
    rows = []  # (group, name, verdict, detail, critical)
    for name, exp in key["fields"].items():
        v, d = score_field(name, exp, out[name])
        rows.append(("field", name, v, d, bool(exp.get("critical"))))

    m = match_items(key["returnables"], out["returnables"], "name")
    for e in key["returnables"]:
        g = out["returnables"][m[e["id"]]] if m[e["id"]] is not None else None
        v, d = score_returnable(e, g)
        if not e["core"] and v == "missed":
            v = "skipped"
        rows.append(("doc", e["id"], v, d, e["core"] and e["mandatory"] is not False))

    md = match_items(key["disqualifiers"], out["disqualifiers"], "condition")
    for e in key["disqualifiers"]:
        g = out["disqualifiers"][md[e["id"]]] if md[e["id"]] is not None else None
        if g is None:
            v, d = ("missed" if e["core"] else "skipped"), "not listed"
        elif _on_page(g, e["pages"]):
            v, d = "correct", g["condition"]
        else:
            v, d = ("flagged" if g.get("confidence") == "low" else "wrong"), f"{g['condition']} (page {g.get('page')})"
        rows.append(("disq", e["id"], v, d, False))

    matched = {i for i in m.values() if i is not None}
    extras = [g for i, g in enumerate(out["returnables"]) if i not in matched]

    critical = [r for r in rows if r[4]]
    crit_ok = all(r[2] in ("correct", "flagged") for r in critical)
    other = [r for r in rows if not r[4] and r[2] != "skipped"]
    other_acc = sum(r[2] == "correct" for r in other) / max(1, len(other))
    return {
        "rows": rows,
        "extras": [{"name": g["name"], "verified": g.get("verified"), "page": g.get("page")} for g in extras],
        "critical_ok": crit_ok,
        "other_accuracy": other_acc,
        "passed": crit_ok and other_acc >= 0.9,
    }


ICON = {"correct": "OK  ", "flagged": "LOW ", "wrong": "XX  ", "missed": "MISS", "skipped": "--  "}


def print_report(name: str, r: dict) -> None:
    print(f"\n=== {name}: {'PASS' if r['passed'] else 'FAIL'}  "
          f"(closing date + mandatory docs {'OK' if r['critical_ok'] else 'NOT OK'}; other fields {r['other_accuracy']:.0%})")
    for group, n, v, d, crit in r["rows"]:
        print(f"  {ICON[v]} {group:5} {n:16}{' *' if crit else '  '} {d}")
    if r["extras"]:
        print("  Extra documents listed by the AI (check they're real requirements):")
        for e in r["extras"]:
            print(f"    - {e['name']} (p.{e['page']}{', QUOTE NOT FOUND' if e['verified'] is False else ''})")


def main() -> None:
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", help="score saved outputs in this folder instead of calling the model")
    args = ap.parse_args()

    keys = sorted(KEYS.glob("*.json"))
    if not keys:
        sys.exit(f"No answer keys in {KEYS}")
    run_dir = Path(args.src) if args.src else ROOT / "results" / datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)

    results = {}
    for kp in keys:
        key = json.loads(kp.read_text(encoding="utf-8"))
        out_path = run_dir / kp.name
        if args.src:
            out = json.loads(out_path.read_text(encoding="utf-8"))
        else:
            from ai_extract import extract_fields, files_from_pdfs
            pdf = ROOT / key["file"]
            print(f"Extracting {pdf.name}…", file=sys.stderr)
            out, s, res = extract_fields(files_from_pdfs([str(pdf)]))
            out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"  {res.provider}/{res.model} {res.seconds:.1f}s, tokens in {res.input_tokens} out {res.output_tokens}", file=sys.stderr)
        results[key["file"]] = score_tender(key, out)
        print_report(key["file"], results[key["file"]])

    passed = all(r["passed"] for r in results.values())
    summary = {k: {"passed": r["passed"], "critical_ok": r["critical_ok"], "other_accuracy": round(r["other_accuracy"], 3)} for k, r in results.items()}
    (run_dir / "score.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nGATE: {'PASS' if passed else 'FAIL'}  ({sum(r['passed'] for r in results.values())}/{len(results)} tenders)  saved to {run_dir}")
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
