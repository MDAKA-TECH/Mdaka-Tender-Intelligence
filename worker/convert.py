"""Word → PDF with LibreOffice, so Word tender documents get real page numbers and a PDF preview.

Needs `soffice` (LibreOffice) on the worker; the Docker image installs it.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile

WORD_EXTENSIONS = (".docx", ".doc")
TIMEOUT = 180  # seconds; a big tender pack in Word converts in well under a minute


def is_word(file_name: str, data: bytes | None = None) -> bool:
    if file_name.lower().endswith(WORD_EXTENSIONS):
        return True
    return False


def soffice() -> str | None:
    return shutil.which("soffice") or shutil.which("libreoffice")


def word_to_pdf(data: bytes, file_name: str) -> bytes:
    exe = soffice()
    if not exe:
        raise ValueError("Word files need LibreOffice on the worker. Upload a PDF instead, or update the worker.")
    ext = ".docx" if file_name.lower().endswith(".docx") else ".doc"
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "input" + ext)
        with open(src, "wb") as f:
            f.write(data)
        # A private profile folder per run: LibreOffice refuses to start twice on one profile.
        env = dict(os.environ, HOME=tmp)
        try:
            subprocess.run(
                [exe, "--headless", "--norestore", "--nologo", f"-env:UserInstallation=file://{tmp}/profile",
                 "--convert-to", "pdf", "--outdir", tmp, src],
                check=True, capture_output=True, timeout=TIMEOUT, env=env,
            )
        except subprocess.TimeoutExpired as e:
            raise ValueError("The Word file took too long to convert. Save it as PDF and upload that instead.") from e
        except subprocess.CalledProcessError as e:
            raise ValueError("This Word file couldn't be opened. Save it as PDF and upload that instead.") from e
        out = os.path.join(tmp, "input.pdf")
        if not os.path.exists(out) or os.path.getsize(out) == 0:
            raise ValueError("This Word file couldn't be converted. Save it as PDF and upload that instead.")
        with open(out, "rb") as f:
            return f.read()
