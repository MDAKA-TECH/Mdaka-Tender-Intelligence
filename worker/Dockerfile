# Extraction worker image (Railway, Render, Fly.io or any Docker host). Includes Tesseract OCR.
# Secrets are NOT baked in: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LLM_PROVIDER, LLM_MODEL,
# GEMINI_API_KEY (etc.) as environment variables on the host.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY *.py ./

# Run as a normal user, not root.
RUN useradd --create-home --uid 10001 worker
USER worker

# The worker polls Supabase; it needs no open port. SIGTERM (host restart/redeploy) is handled cleanly.
CMD ["python", "worker.py"]
