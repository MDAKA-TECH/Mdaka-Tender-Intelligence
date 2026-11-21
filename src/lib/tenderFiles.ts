import { friendlyError, supabase } from './supabase';

export const TENDER_BUCKET = 'tenders';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const TENDER_FILE_ACCEPT =
  '.pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function fileKind(name: string): 'pdf' | 'word' | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx') || n.endsWith('.doc')) return 'word';
  return null;
}

// Tender packs may be PDF or Word. Word files are converted to PDF by the worker.
export function checkTenderFile(f: File): string | null {
  const kind = fileKind(f.name) ?? (f.type === 'application/pdf' ? 'pdf' : f.type === DOCX || f.type === 'application/msword' ? 'word' : null);
  if (!kind) return `${f.name} isn't a PDF or Word document.`;
  if (f.size > MAX_FILE_BYTES) return `${f.name} is over 50 MB.`;
  if (f.size === 0) return `${f.name} is empty.`;
  return null;
}

function contentType(f: File): string {
  const n = f.name.toLowerCase();
  if (n.endsWith('.docx')) return DOCX;
  if (n.endsWith('.doc')) return 'application/msword';
  return 'application/pdf';
}

// Uploads each file and queues it for the extraction worker. Returns the names that failed.
export async function uploadTenderFiles(companyId: string, tenderId: string, files: File[]): Promise<{ failed: { name: string; error: string }[] }> {
  const failed: { name: string; error: string }[] = [];
  for (const file of files) {
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${companyId}/${tenderId}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from(TENDER_BUCKET).upload(path, file, { contentType: contentType(file), upsert: false });
    if (up.error) {
      failed.push({ name: file.name, error: friendlyError(up.error) });
      continue;
    }
    const { error } = await supabase.from('tender_files').insert({ tender_id: tenderId, file_path: path, file_name: file.name, file_size: file.size });
    if (error) {
      await supabase.storage.from(TENDER_BUCKET).remove([path]);
      failed.push({ name: file.name, error: friendlyError(error) });
    }
  }
  return { failed };
}

// A real, public RFQ from the Parliament of RSA, so anyone can see the whole flow in a minute.
export const SAMPLE_TENDER = { url: '/sample/RFQ_906_2026.pdf', name: 'Sample - RFQ 906-2026 (Parliament, data analyst services).pdf' };
export async function sampleTenderFile(): Promise<File> {
  const res = await fetch(SAMPLE_TENDER.url);
  if (!res.ok) throw new Error("Couldn't load the sample document.");
  return new File([await res.blob()], SAMPLE_TENDER.name, { type: 'application/pdf' });
}
