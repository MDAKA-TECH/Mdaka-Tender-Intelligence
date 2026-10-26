// Checklist → PDF for printing or sharing. Loaded on demand (jsPDF is ~350 KB), see TenderDetail.
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { FIELD_LABEL, KIND_LABEL, fieldValue } from './fields';
import { TENDER_STATUS_LABEL, docTypeInfo, type AiFields, type Requirement, type Tender } from './types';
import { fmtDate, fmtDateTime } from './dates';
import { matchVault, type VaultDoc } from './vault';

export interface ExportInput {
  tender: Tender;
  companyName: string;
  userName: string;
  reqs: Requirement[];
  vault: VaultDoc[];
  ai: AiFields | null;
  now?: Date;
}

const ACCENT: [number, number, number] = [13, 106, 91];
const INK: [number, number, number] = [24, 32, 29];
const MUTED: [number, number, number] = [88, 105, 102];
const LINE: [number, number, number] = [217, 225, 222];
const WARN_BG: [number, number, number] = [251, 239, 217];
const WARN: [number, number, number] = [154, 91, 0];
const CRIT: [number, number, number] = [179, 38, 30];

// The built-in PDF fonts only cover Windows-1252. Swap the usual offenders, drop the rest.
const WIN1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const SWAPS: Record<string, string> = { '≥': '>=', '≤': '<=', '→': '->', '✓': 'x', '✔': 'x', ' ': ' ', ' ': ' ', ' ': ' ', '−': '-', '‐': '-', '‑': '-' };
export function pdfText(s: string | null | undefined): string {
  if (!s) return '';
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (SWAPS[ch] != null) out += SWAPS[ch];
    else if (ch.charCodeAt(0) <= 0xff || WIN1252_EXTRA.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

// Shown at the top from the tender details the team saved, so not repeated from the AI.
const IN_HEADER = new Set(['closing', 'briefing', 'submission', 'reference_no', 'issuing_entity', 'description']);
const isDoc = (r: Requirement) => r.kind !== 'disqualifier' && r.kind !== 'special';

export function fileName(t: Tender): string {
  const base = (t.reference_no || t.description || 'tender').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `Checklist - ${base}.pdf`;
}

export function buildChecklistPdf(input: ExportInput): jsPDF {
  const { tender: t, reqs, vault, ai } = input;
  const now = input.now ?? new Date();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = M;

  const files = ai?.files ?? [];
  const multi = files.length > 1;
  const where = (fileId: string | null, page: number | null) => {
    if (!page) return '';
    const n = files.find((f) => f.id === fileId)?.n;
    return `${multi && n ? `File ${n}, ` : ''}p. ${page}`;
  };

  const confirmed = reqs.filter((r) => r.confirmed && r.status !== 'not_applicable');
  const docs = confirmed.filter(isDoc);
  const disq = confirmed.filter((r) => r.kind === 'disqualifier');
  const special = confirmed.filter((r) => r.kind === 'special');
  const toReview = reqs.filter((r) => !r.confirmed);
  const dismissed = reqs.filter((r) => r.confirmed && r.status === 'not_applicable');
  const matches = new Map(docs.filter((r) => r.doc_type).map((r) => [r.id, matchVault(r.doc_type!, vault, t.closing_at, now)]));
  const vaultProblems = [...matches.values()].filter((m) => m.tone !== 'ok').length;
  const prepared = docs.filter((r) => r.status === 'done').length;

  // ---- heading
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
  doc.text(pdfText(`Tender checklist · ${input.companyName}`), M, y);
  y += 22;
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...INK);
  const title = doc.splitTextToSize(pdfText(t.reference_no || 'Untitled tender'), W - 2 * M);
  doc.text(title, M, y);
  y += title.length * 21;
  const sub = [t.entity, t.description].filter(Boolean).join(' · ');
  if (sub) {
    doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(...MUTED);
    const lines = doc.splitTextToSize(pdfText(sub), W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 13;
  }
  y += 6;

  // ---- key dates
  const briefing = t.briefing_at
    ? `${fmtDateTime(t.briefing_at)}${t.briefing_compulsory ? ' (compulsory)' : t.briefing_compulsory === false ? ' (optional)' : ''}`
    : t.briefing_compulsory === false ? 'Not compulsory' : 'None recorded';
  const submission = ai?.fields?.submission ? fieldValue('submission', ai.fields.submission) : '';
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: { top: 3, bottom: 3, left: 0, right: 8 }, textColor: INK },
    columnStyles: { 0: { cellWidth: 110, textColor: MUTED } },
    body: [
      ['Closing', t.closing_at ? fmtDateTime(t.closing_at) : 'Not set'],
      ['Briefing', briefing],
      ...(submission ? [['Submission', submission]] : []),
      ['Status', TENDER_STATUS_LABEL[t.status]],
      ['Progress', `${prepared} of ${docs.length} documents prepared${vaultProblems ? ` · ${vaultProblems} vault problem${vaultProblems > 1 ? 's' : ''}` : ''}`],
    ].map((r) => r.map(pdfText)),
  });
  y = lastY(doc) + 10;

  if (toReview.length) {
    const msg = pdfText(`${toReview.length} item${toReview.length > 1 ? 's' : ''} found by the AI ${toReview.length > 1 ? 'are' : 'is'} not reviewed yet. ${toReview.length > 1 ? 'They are' : 'It is'} listed at the end and not counted above.`);
    const lines = doc.splitTextToSize(msg, W - 2 * M - 20);
    const h = lines.length * 12 + 14;
    doc.setFillColor(...WARN_BG).roundedRect(M, y, W - 2 * M, h, 4, 4, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...WARN).text(lines, M + 10, y + 16);
    y += h + 12;
  }

  // ---- documents
  y = sectionTitle(doc, 'Documents to submit', y, M);
  if (!docs.length) y = note(doc, 'No confirmed documents yet. Review the AI results in the app first.', y, M);
  else {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['', 'Document', 'Vault', 'Source']],
      body: docs.map((r) => {
        const m = matches.get(r.id);
        const vaultText = !r.doc_type ? 'Prepare for this tender' : m ? `${m.label}${m.doc?.expires_on && m.state !== 'on_file' ? ` (${fmtDate(m.doc.expires_on)})` : ''}` : '';
        const lines = [r.description, r.mandatory ? 'Mandatory' : 'Optional', r.conditions ? `Conditions: ${r.conditions}` : '', r.doc_type ? `Vault: ${docTypeInfo(r.doc_type).name}` : '']
          .filter(Boolean).join('\n');
        return ['', pdfText(lines), pdfText(vaultText), pdfText(where(r.source_file_id, r.source_page))];
      }),
      ...tableStyle(),
      columnStyles: { 0: { cellWidth: 22 }, 2: { cellWidth: 120 }, 3: { cellWidth: 70 } },
      didParseCell: (d) => {
        if (d.section !== 'body') return;
        const r = docs[d.row.index];
        if (d.column.index === 2) {
          const m = matches.get(r.id);
          if (m?.tone === 'crit') d.cell.styles.textColor = CRIT;
          else if (m?.tone === 'warn') d.cell.styles.textColor = WARN;
        }
        if (r.status === 'done' && d.column.index === 1) d.cell.styles.textColor = MUTED;
      },
      didDrawCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 0) return;
        const done = docs[d.row.index].status === 'done';
        const x = d.cell.x + 5, yy = d.cell.y + 6, s = 10;
        doc.setDrawColor(...(done ? ACCENT : MUTED)).setLineWidth(0.8).rect(x, yy, s, s);
        if (done) doc.setDrawColor(...ACCENT).setLineWidth(1.4).lines([[2.5, 3], [5, -6.5]], x + 1.8, yy + 5.2);
      },
    });
    y = lastY(doc) + 16;
  }

  if (disq.length) {
    y = sectionTitle(doc, 'Avoid disqualification', y, M);
    y = simpleList(doc, disq.map((r) => [r.description, where(r.source_file_id, r.source_page)]), y, M);
  }
  if (special.length) {
    y = sectionTitle(doc, 'Other requirements', y, M);
    y = simpleList(doc, special.map((r) => [r.conditions ? `${r.description} (${r.conditions})` : r.description, where(r.source_file_id, r.source_page)]), y, M);
  }

  // ---- key facts
  const facts = ai?.fields
    ? FIELD_LABEL.filter(([k]) => !IN_HEADER.has(k)).flatMap(([k, label]) => {
        const f = ai.fields[k];
        const v = f ? fieldValue(k, f) : '';
        return v ? [[label, v, where(files.find((x) => x.n === f.file)?.id ?? null, f.page)]] : [];
      })
    : [];
  if (facts.length) {
    y = sectionTitle(doc, 'More from the tender documents', y, M);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      body: facts.map((r) => r.map(pdfText)),
      ...tableStyle(),
      columnStyles: { 0: { cellWidth: 120, textColor: MUTED }, 2: { cellWidth: 70 } },
    });
    y = lastY(doc) + 16;
  }

  if (toReview.length) {
    y = sectionTitle(doc, 'Not reviewed yet', y, M);
    y = simpleList(doc, toReview.map((r) => [`${r.description} (${KIND_LABEL[r.kind] ?? r.kind}${r.mandatory ? ', mandatory' : ''})`, where(r.source_file_id, r.source_page)]), y, M);
  }
  if (dismissed.length) {
    y = sectionTitle(doc, 'Marked not required', y, M);
    y = simpleList(doc, dismissed.map((r) => [r.description, where(r.source_file_id, r.source_page)]), y, M);
  }
  if (multi) {
    y = sectionTitle(doc, 'Files', y, M);
    autoTable(doc, { startY: y, margin: { left: M, right: M }, body: files.map((f) => [pdfText(`File ${f.n}: ${f.name}`)]), ...tableStyle() });
    y = lastY(doc) + 16;
  }

  // ---- disclaimer
  const disclaimer = pdfText(
    `Exported by ${input.userName} on ${fmtDateTime(now.toISOString())}. This checklist was built from the tender documents with AI help and checked by your team. ` +
      'It does not confirm that a bid is compliant: check every requirement against the tender document before you submit.',
  );
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...MUTED);
  const lines = doc.splitTextToSize(disclaimer, W - 2 * M);
  if (y + lines.length * 11 > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); y = M; }
  doc.text(lines, M, y + 4);

  // ---- footers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LINE).setLineWidth(0.5).line(M, H - 30, W - M, H - 30);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    doc.text(pdfText(`Tender Intelligence · ${t.reference_no || 'Untitled tender'}`), M, H - 18);
    doc.text(`Page ${i} of ${pages}`, W - M, H - 18, { align: 'right' });
  }
  return doc;
}

export function exportChecklistPdf(input: ExportInput): void {
  buildChecklistPdf(input).save(fileName(input.tender));
}

// ---------------------------------------------------------------- helpers

function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

function tableStyle() {
  return {
    theme: 'grid' as const,
    styles: { fontSize: 9.5, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5, valign: 'top' as const },
    headStyles: { fillColor: [233, 238, 236] as [number, number, number], textColor: MUTED, fontStyle: 'bold' as const, fontSize: 8.5 },
  };
}

function sectionTitle(doc: jsPDF, text: string, y: number, M: number): number {
  if (y > doc.internal.pageSize.getHeight() - 110) { doc.addPage(); y = M; }
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...ACCENT).text(pdfText(text), M, y);
  return y + 8;
}

function note(doc: jsPDF, text: string, y: number, M: number): number {
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED).text(pdfText(text), M, y + 10);
  return y + 28;
}

function simpleList(doc: jsPDF, rows: [string, string][], y: number, M: number): number {
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    body: rows.map((r) => r.map(pdfText)),
    ...tableStyle(),
    columnStyles: { 1: { cellWidth: 70 } },
  });
  return lastY(doc) + 16;
}
