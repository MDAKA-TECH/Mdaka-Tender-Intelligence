export type DocType =
  | 'tax_compliance'
  | 'csd_report'
  | 'bbbee'
  | 'cipc_registration'
  | 'director_ids'
  | 'bank_letter'
  | 'coid'
  | 'other';

export interface Company {
  id: string;
  name: string;
  csd_supplier_no: string | null;
  bbbee_level: number | null;
}

export interface AppUser {
  id: string;
  company_id: string;
  email: string;
  name: string;
}

export interface CompanyDocument {
  id: string;
  doc_type: DocType;
  label: string | null;
  file_path: string;
  file_name: string;
  file_size: number | null;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
}

export interface DocTypeInfo {
  type: DocType;
  name: string;
  // Asked for in most SA public-sector bids, so a missing one is flagged.
  core: boolean;
  expires: boolean;
  hint: string;
}

export const DOC_TYPES: DocTypeInfo[] = [
  { type: 'tax_compliance', name: 'Tax compliance status (TCS PIN)', core: true, expires: true, hint: 'From SARS eFiling. Enter the expiry date shown on the status.' },
  { type: 'csd_report', name: 'CSD registration report', core: true, expires: false, hint: 'From the Central Supplier Database. Download a fresh report before each bid.' },
  { type: 'bbbee', name: 'B-BBEE certificate or sworn affidavit', core: true, expires: true, hint: 'Enter the expiry date printed on the certificate or affidavit.' },
  { type: 'cipc_registration', name: 'CIPC company registration', core: true, expires: false, hint: 'Registration certificate (e.g. CoR 14.3) showing the directors.' },
  { type: 'director_ids', name: "Certified copies of directors' IDs", core: false, expires: true, hint: 'Some tenders want certification within the last 3–6 months. Use the certification date as the issue date.' },
  { type: 'bank_letter', name: 'Bank confirmation letter', core: false, expires: false, hint: 'Stamped letter confirming the company account.' },
  { type: 'coid', name: 'COID letter of good standing', core: false, expires: true, hint: 'Usually needed for on-site or construction work.' },
  { type: 'other', name: 'Other document', core: false, expires: true, hint: 'Give it a clear name, e.g. "Professional indemnity cover".' },
];

export const docTypeInfo = (t: DocType) => DOC_TYPES.find((d) => d.type === t)!;

// ---------------------------------------------------------------- tenders (week 2)
export type TenderStatus = 'reviewing' | 'preparing' | 'submitted' | 'won' | 'lost' | 'not_bidding';
export type ExtractionStatus = 'queued' | 'extracting' | 'done' | 'failed';

export const TENDER_STATUS_LABEL: Record<TenderStatus, string> = {
  reviewing: 'Reviewing',
  preparing: 'Preparing',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
  not_bidding: 'Not bidding',
};

export interface Tender {
  id: string;
  reference_no: string | null;
  entity: string | null;
  description: string | null;
  closing_at: string | null;
  briefing_at: string | null;
  briefing_compulsory: boolean | null;
  status: TenderStatus;
  created_at: string;
}

export interface TenderFile {
  id: string;
  tender_id: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  status: ExtractionStatus;
  error: string | null;
  page_count: number | null;
  ocr_used: boolean;
  ocr_pages: number[];
  extracted_at: string | null;
  created_at: string;
}

export interface PageText {
  page: number;
  text: string;
  ocr?: boolean;
}
