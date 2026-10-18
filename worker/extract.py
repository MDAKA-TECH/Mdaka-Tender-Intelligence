"""Page-by-page text extraction for tender PDFs.

Text layer first (PyMuPDF). A page is sent to OCR (Tesseract) when it has almost no text
but does have images, or when its text layer is garbage (broken font encodings).
No Supabase code here, so it can be tested on local files:  python extract.py some.pdf
"""
from __future__ import annotations

import io
import re
import shutil
import sys
from dataclasses import dataclass, field

import pymupdf  # PyMuPDF

MIN_WORDS = 25        # fewer words than this on a page with images → probably scanned
OCR_DPI = 300
OCR_LANG = "eng"

_word = re.compile(r"[A-Za-z0-9]{2,}")


@dataclass
class PageText:
    page: int          # 1-based
    text: str
    ocr: bool = False


@dataclass
class Result:
    page_count: int
    pages: list[PageText] = field(default_factory=list)
    ocr_pages: list[int] = field(default_factory=list)       # pages where OCR was used
    needs_ocr: list[int] = field(default_factory=list)       # pages that needed OCR but it wasn't available
    warnings: list[str] = field(default_factory=list)

    def as_json(self) -> list[dict]:
        return [{"page": p.page, "text": p.text, "ocr": p.ocr} for p in self.pages]


def tesseract_available() -> bool:
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    if shutil.which("tesseract"):
        return True
    # Windows default install path (UB Mannheim installer).
    import os
    win = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    if os.path.exists(win):
        import pytesseract
        pytesseract.pytesseract.tesseract_cmd = win
        return True
    return False


def _clean(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _looks_garbled(text: str) -> bool:
    if len(text) < 200:
        return False
    letters = sum(c.isalpha() for c in text)
    odd = sum(1 for c in text if ord(c) > 0x2FFF or (not c.isprintable() and c not in "\n\t"))
    return letters / len(text) < 0.35 or odd / len(text) > 0.15


def _needs_ocr(page: "pymupdf.Page", text: str) -> bool:
    words = len(_word.findall(text))
    if _looks_garbled(text):
        return True
    return words < MIN_WORDS and len(page.get_images(full=False)) > 0


def _ocr_page(page: "pymupdf.Page") -> str:
    import pytesseract
    from PIL import Image

    pix = page.get_pixmap(dpi=OCR_DPI, colorspace=pymupdf.csGRAY)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    return pytesseract.image_to_string(img, lang=OCR_LANG, config="--psm 3")


def extract_pdf(data: bytes, ocr: bool | None = None) -> Result:
    """Extract text from PDF bytes. ocr=None → use OCR if Tesseract is installed."""
    use_ocr = tesseract_available() if ocr is None else ocr
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Not a readable PDF ({e.__class__.__name__}).") from e
    if doc.needs_pass:
        raise ValueError("The PDF is password-protected. Upload an unlocked copy.")

    res = Result(page_count=doc.page_count)
    for i, page in enumerate(doc, start=1):
        text = page.get_text("text", sort=True)
        used = False
        if _needs_ocr(page, text):
            if use_ocr:
                try:
                    ocr_text = _ocr_page(page)
                    # Keep whichever has more real words (some pages have a thin text layer over a scan).
                    if len(_word.findall(ocr_text)) > len(_word.findall(text)):
                        text, used = ocr_text, True
                        res.ocr_pages.append(i)
                except Exception as e:  # noqa: BLE001
                    res.warnings.append(f"OCR failed on page {i}: {e}")
            else:
                res.needs_ocr.append(i)
        res.pages.append(PageText(page=i, text=_clean(text), ocr=used))
    doc.close()

    if res.needs_ocr:
        res.warnings.append(
            f"{len(res.needs_ocr)} page(s) look scanned but OCR is not installed: "
            + ", ".join(map(str, res.needs_ocr))
        )
    return res


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, "rb") as f:
            r = extract_pdf(f.read())
        words = sum(len(_word.findall(p.text)) for p in r.pages)
        print(f"{path}: {r.page_count} pages, {words} words, OCR pages {r.ocr_pages or 'none'}")
        for w in r.warnings:
            print("  warning:", w)
        for p in r.pages[:2]:
            print(f"  --- page {p.page}{' (OCR)' if p.ocr else ''}: {p.text[:160]!r}")
