"""Tender text → AI → verified fields.

  python ai_extract.py ../test-set/RFQ_906_2026.pdf [more.pdf ...]   # one tender made of these files
Writes the verified result to stdout as JSON (and a short summary to stderr).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

import llm
from extract import extract_pdf, tesseract_available
from fields import build_user_prompt
from verify import check, schema_errors, summary


def extract_fields(files: list[dict]) -> tuple[dict, dict, llm.LLMResult]:
    """files: [{"name", "pages": [{"page", "text"}]}] in a stable order (file numbers are 1-based indexes)."""
    prompt = build_user_prompt(files)
    try:
        res = llm.call(prompt)
    except llm.LLMError as e:
        if "invalid JSON" not in str(e):
            raise
        res = llm.call(prompt + "\n\nYour previous answer was not valid JSON. Return one complete JSON object only.")
    errs = schema_errors(res.data)
    if errs:
        # One retry, telling the model exactly what was wrong (mostly needed for Gemini,
        # which can't be forced to follow the schema).
        fix = ("\n\nYour previous answer did not match the required JSON schema:\n- " + "\n- ".join(errs[:10])
               + "\nReturn the complete answer again, fixing these problems.")
        res = llm.call(prompt + fix)
    checked = check(res.data, files)  # raises ValueError if it's still malformed
    return checked, summary(checked), res


CACHE_VERSION = 1  # bump when extraction changes, so cached text is redone


def files_from_pdfs(paths: list[str], cache_dir: str | Path | None = None) -> list[dict]:
    """Page text for each PDF. With cache_dir, text is saved per file content, so scanned PDFs
    are only OCR'd once (used by evaluate.py; the worker reads each upload once anyway)."""
    import hashlib

    out = []
    for p in paths:
        data = Path(p).read_bytes()
        cached = None
        if cache_dir:
            digest = hashlib.sha256(data).hexdigest()[:24]
            cached = Path(cache_dir) / f"{digest}-v{CACHE_VERSION}.json"
            if cached.exists():
                entry = json.loads(cached.read_text(encoding="utf-8"))
                # A cache made without OCR is ignored once OCR is available.
                if not entry["needs_ocr"] or not tesseract_available():
                    out.append({**entry, "name": Path(p).name})
                    continue

        def show(done: int, total: int, name: str = Path(p).name) -> None:
            print(f"\r  OCR {name}: page {done}/{total}", end="" if done < total else "\n", file=sys.stderr, flush=True)

        r = extract_pdf(data, progress=show)
        # needs_ocr: scanned pages that couldn't be read because Tesseract isn't installed.
        entry = {"name": Path(p).name, "pages": [{"page": pg.page, "text": pg.text} for pg in r.pages], "needs_ocr": r.needs_ocr}
        if cached:
            cached.parent.mkdir(parents=True, exist_ok=True)
            cached.write_text(json.dumps(entry, ensure_ascii=False), encoding="utf-8")
        out.append(entry)
    return out


if __name__ == "__main__":
    load_dotenv()
    if len(sys.argv) < 2:
        sys.exit("Usage: python ai_extract.py tender.pdf [annexure.pdf ...]")
    checked, s, res = extract_fields(files_from_pdfs(sys.argv[1:]))
    print(json.dumps(checked, indent=2, ensure_ascii=False))
    print(f"{res.provider}/{res.model}: {res.seconds:.1f}s, tokens in {res.input_tokens} out {res.output_tokens}; {s}", file=sys.stderr)
