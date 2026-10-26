// How the AI's tender-level fields are labelled and shown (review screen and PDF export).
import type { AiField } from './types';
import { fmtDate } from './dates';

export const FIELD_LABEL: [string, string][] = [
  ['closing', 'Closing'], ['briefing', 'Briefing session'], ['submission', 'Submission'], ['reference_no', 'Reference number'],
  ['issuing_entity', 'Issued by'], ['description', 'Description'], ['evaluation', 'Evaluation'], ['validity_days', 'Bid validity'],
  ['contact', 'Contact'], ['query_deadline', 'Last day for questions'], ['pricing_format', 'Pricing format'],
];
export const METHOD: Record<string, string> = {
  email: 'Email', etenders_upload: 'eTenders upload', tender_box: 'Tender box', hand_delivery: 'Hand delivery',
  courier: 'Courier', online_portal: 'Online portal', other: 'Other',
};
export const KIND_LABEL: Record<string, string> = {
  document: 'Document', form: 'Form', certification: 'Certificate / registration', pricing: 'Pricing',
  disqualifier: 'Disqualification condition', special: 'Other requirement', other: 'Other',
  briefing: 'Briefing', deadline: 'Deadline',
};

type V = Record<string, unknown>;

export function fieldValue(name: string, f: AiField): string {
  if (f.status !== 'found' || f.value == null) return '';
  const v = f.value as V;
  switch (name) {
    case 'closing':
      return `${fmtDate(String(v.date))}${v.time ? ` at ${v.time}` : ', time not stated'}`;
    case 'briefing': {
      if (!v.date) return v.compulsory === false ? 'Not compulsory / not applicable' : 'Mentioned, no date given';
      const parts = [v.compulsory ? 'Compulsory' : v.compulsory === false ? 'Optional' : 'Briefing', fmtDate(String(v.date))];
      if (v.time) parts.push(`at ${v.time}`);
      return parts.join(', ') + (v.venue ? ` · ${v.venue}` : '');
    }
    case 'submission':
      return `${METHOD[String(v.method)] ?? String(v.method)}: ${v.address}`;
    case 'evaluation':
      return [v.preference_system && `${v.preference_system} preference points`, v.functionality_threshold != null && `functionality minimum ${v.functionality_threshold}`]
        .filter(Boolean).join(', ') || 'Stated (see source)';
    case 'validity_days':
      return `${f.value} days`;
    case 'contact':
      return [v.name, v.email, v.phone].filter(Boolean).join(' · ');
    case 'query_deadline':
      return fmtDate(String(f.value));
    default:
      return String(f.value);
  }
}
