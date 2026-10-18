import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

// The anon key is public by design; Row Level Security is what keeps each company's data separate.
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing');

// Turn Postgres / PostgREST / Storage errors into sentences a person can act on.
export function friendlyError(e: { message?: string; code?: string } | null | undefined): string {
  if (!e) return 'Something went wrong. Try again.';
  const m = e.message ?? '';
  if (/row-level security|permission denied/i.test(m)) return "You don't have access to that.";
  if (/Failed to fetch/i.test(m)) return "Can't reach the server. Check your connection.";
  if (/companies_csd_supplier_no_check/.test(m)) return 'CSD supplier numbers look like MAAA1234567.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'That file is too big. The limit is 10 MB.';
  if (/mime type .* is not supported/i.test(m)) return 'Upload a PDF, JPG or PNG.';
  if (/Invalid login credentials/i.test(m)) return 'Email or password is wrong.';
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link.';
  return m || 'Something went wrong. Try again.';
}
