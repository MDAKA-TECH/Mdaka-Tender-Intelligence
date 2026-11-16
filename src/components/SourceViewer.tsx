import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { friendlyError, supabase } from '../lib/supabase';
import { TENDER_BUCKET } from '../lib/tenderFiles';
import type { TenderFile } from '../lib/types';
import { Modal } from './ui';

// Shows the real PDF page a quote came from, with the quote highlighted.
// pdf.js (legacy build: works in older browsers too) is loaded only when this opens, so it doesn't slow down the rest of the app.

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsPromise;
}

interface Box { left: number; top: number; width: number; height: number }
type Mark = 'found' | 'partial' | 'not_found' | 'scanned' | null;

// Letters and digits only, so line breaks, hyphens and spacing in the PDF don't stop a match.
const flatten = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Which text items on the page hold the quote. Tries the whole quote, then its start, then its end.
export function findQuoteItems(items: string[], quote: string): { idx: number[]; partial: boolean } | null {
  let flat = '';
  const owner: number[] = [];
  items.forEach((s, i) => {
    const f = flatten(s);
    flat += f;
    for (let k = 0; k < f.length; k++) owner.push(i);
  });
  const q = flatten(quote);
  if (q.length < 4) return null;
  const tries: [string, boolean][] = [[q, false]];
  if (q.length > 60) tries.push([q.slice(0, 60), true], [q.slice(-60), true]);
  if (q.length > 30) tries.push([q.slice(0, 30), true]);
  for (const [needle, partial] of tries) {
    const at = flat.indexOf(needle);
    if (at >= 0) {
      const idx = Array.from(new Set(owner.slice(at, at + needle.length)));
      return { idx, partial };
    }
  }
  return null;
}

export default function SourceViewer({ file, initialPage, quote, onClose, onShowText }: {
  file: TenderFile;
  initialPage?: number;
  quote?: string;
  onClose: () => void;
  onShowText: (page: number) => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage ?? 1);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [mark, setMark] = useState<Mark>(null);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    let loading: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const path = file.preview_path || file.file_path;
        const { data, error: e } = await supabase.storage.from(TENDER_BUCKET).createSignedUrl(path, 600);
        if (e || !data) throw new Error(friendlyError(e));
        const lib = await loadPdfJs();
        if (cancelled) return;
        const task = lib.getDocument({ url: data.signedUrl });
        loading = task;
        const loaded = await task.promise;
        if (cancelled) return;
        setDoc(loaded);
        setPage((p) => Math.min(Math.max(1, p), loaded.numPages));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      loading?.destroy();
    };
  }, [file.preview_path, file.file_path]);

  // Draw the page and work out where the quote is.
  useEffect(() => {
    if (!doc || !canvasRef.current || !wrapRef.current) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    setRendering(true);
    (async () => {
      try {
        const p = await doc.getPage(page);
        const base = p.getViewport({ scale: 1 });
        const cssWidth = Math.min(wrapRef.current!.clientWidth || 800, 860);
        const viewport = p.getViewport({ scale: cssWidth / base.width });
        const ratio = window.devicePixelRatio || 1;
        const canvas = canvasRef.current!;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        task = p.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
        await task.promise;
        if (cancelled) return;

        if (!quote) {
          setBoxes([]);
          setMark(null);
          return;
        }
        const content = await p.getTextContent();
        const items = content.items.filter((i): i is Extract<typeof i, { str: string }> => 'str' in i);
        if (!items.some((i) => i.str.trim())) {
          setBoxes([]);
          setMark('scanned');
          return;
        }
        const hit = findQuoteItems(items.map((i) => i.str), quote);
        if (!hit) {
          setBoxes([]);
          setMark('not_found');
          return;
        }
        const out: Box[] = [];
        for (const k of hit.idx) {
          const it = items[k];
          if (!it.str.trim()) continue;
          const [, , , d, x, y] = it.transform as number[];
          const h = it.height || Math.abs(d) || 10;
          const [x1, y1] = viewport.convertToViewportPoint(x, y);
          const [x2, y2] = viewport.convertToViewportPoint(x + it.width, y + h);
          out.push({ left: Math.min(x1, x2) - 2, top: Math.min(y1, y2) - 2, width: Math.abs(x2 - x1) + 4, height: Math.abs(y2 - y1) + 4 });
        }
        setBoxes(out);
        setMark(hit.partial ? 'partial' : 'found');
        // Bring the first highlight into view.
        if (out.length) wrapRef.current?.scrollTo({ top: Math.max(0, out[0].top - 80), behavior: 'smooth' });
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === 'RenderingCancelledException')) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, quote]);

  const max = doc?.numPages ?? 1;
  return (
    <Modal title={file.file_name} onClose={onClose}>
      <div className="viewer">
        <div className="toolbar">
          <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!doc || page <= 1} aria-label="Previous page"><ChevronLeft className="ico" aria-hidden="true" /></button>
          <span className="mono">Page {page} / {doc ? max : '…'}</span>
          <button className="btn" onClick={() => setPage((p) => Math.min(max, p + 1))} disabled={!doc || page >= max} aria-label="Next page"><ChevronRight className="ico" aria-hidden="true" /></button>
          {page === initialPage && mark === 'found' && <span className="pill ok">Quote highlighted</span>}
          {page === initialPage && mark === 'partial' && <span className="pill warn">Start of the quote highlighted</span>}
          <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => onShowText(page)}>Show text instead</button>
        </div>
        {page === initialPage && mark === 'scanned' && (
          <div className="callout warn small">This page is a scan, so the quote can't be highlighted. It was read by OCR from this page: check it by eye.</div>
        )}
        {page === initialPage && mark === 'not_found' && (
          <div className="callout warn small">Couldn't pinpoint the quote on this page. It may be split across a table or a page break. Use <b>Show text instead</b> to search for it.</div>
        )}
        {error && <div className="callout crit">Couldn't show the PDF: {error} <button className="btn ghost" onClick={() => onShowText(page)}>Show text instead</button></div>}
        {!doc && !error && <p className="muted">Loading the PDF…</p>}
        <div className="pdf-stage" ref={wrapRef} aria-busy={rendering}>
          <div className="pdf-page">
            <canvas ref={canvasRef} aria-label={`Page ${page} of ${file.file_name}`} />
            {page === initialPage && boxes.map((b, i) => <span key={i} className="pdf-hl" style={b} />)}
          </div>
        </div>
        {quote && (
          <div className="quote-box"><span className="quote-label">Quote from the AI</span><q>{quote}</q></div>
        )}
      </div>
    </Modal>
  );
}
