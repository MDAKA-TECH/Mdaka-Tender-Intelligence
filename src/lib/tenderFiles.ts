import { friendlyError, supabase } from './supabase';

export const TENDER_BUCKET = 'tenders';
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

export function checkPdf(f: File): string | null {
  const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return `${f.name} is not a PDF.`;
  if (f.size > MAX_PDF_BYTES) return `${f.name} is over 50 MB.`;
  if (f.size === 0) return `${f.name} is empty.`;
  return null;
}

// Uploads each PDF and queues it for the extraction worker. Returns the names that failed.
export async function uploadTenderFiles(companyId: string, tenderId: string, files: File[]): Promise<{ failed: { name: string; error: string }[] }> {
  const failed: { name: string; error: string }[] = [];
  for (const file of files) {
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${companyId}/${tenderId}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from(TENDER_BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
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
