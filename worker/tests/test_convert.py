"""Word → PDF conversion. Skipped when LibreOffice isn't installed (it is in the Docker image)."""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from convert import is_word, soffice, word_to_pdf  # noqa: E402
from extract import extract_pdf  # noqa: E402


def minimal_docx(paragraphs: list[str], page_break_after: int | None = None) -> bytes:
    """A tiny valid .docx built by hand, so the test needs no extra packages."""
    body = []
    for i, text in enumerate(paragraphs):
        body.append(f'<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>')
        if page_break_after is not None and i == page_break_after:
            body.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
           + "".join(body) + '</w:body></w:document>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", doc)
    return buf.getvalue()


def test_is_word():
    assert is_word("SBD 4.DOCX") and is_word("form.doc") and not is_word("rfq.pdf")


@pytest.mark.skipif(not soffice(), reason="LibreOffice not installed")
def test_word_becomes_pages():
    data = minimal_docx(["Closing date: 28 November 2026 at 11:00.", "Failure to submit SBD 4 will result in disqualification.",
                         "A valid tax compliance status PIN must be provided."], page_break_after=1)
    res = extract_pdf(word_to_pdf(data, "rfq.docx"), ocr=False)
    assert res.page_count == 2
    assert "11:00" in res.pages[0].text and "SBD 4" in res.pages[0].text
    assert "tax compliance" in res.pages[1].text
