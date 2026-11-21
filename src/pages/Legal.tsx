import { ArrowLeft } from 'lucide-react';
import { usePageTitle } from '../components/ui';

// Privacy notice and terms of use. Readable without signing in, at #/privacy and #/terms.
// DRAFT: written from how the app works today. Have a legal adviser review both before charging customers.

const UPDATED = '15 November 2026';
const COMPANY = 'Mdaka Advanced Technologies (Pty) Ltd';

export default function Legal({ page }: { page: 'privacy' | 'terms' }) {
  usePageTitle(page === 'privacy' ? 'Privacy notice' : 'Terms of use');
  const back = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = '#/';
  };
  return (
    <div className="legal">
      <article className="legal-sheet panel">
        <div className="panel-body">
          <button className="btn ghost back" onClick={back}><ArrowLeft className="ico" aria-hidden="true" />Back</button>
          <p className="small muted" style={{ margin: '8px 0 0' }}>Tender Intelligence · {COMPANY}</p>
          <nav className="legal-tabs" aria-label="Legal">
            <a href="#/privacy" aria-current={page === 'privacy' ? 'page' : undefined}>Privacy notice</a>
            <a href="#/terms" aria-current={page === 'terms' ? 'page' : undefined}>Terms of use</a>
          </nav>
          {page === 'privacy' ? <Privacy /> : <Terms />}
          <p className="small muted legal-foot">
            Last updated {UPDATED}. {COMPANY}, registration 2026/160396/07, 286 Saron Street, Garsfontein, Pretoria, 0081.
            Questions: <a href="mailto:info@mdakatech.com">info@mdakatech.com</a>
          </p>
        </div>
      </article>
    </div>
  );
}

function Privacy() {
  return (
    <>
      <h1>Privacy notice</h1>
      <p>
        This notice explains what Tender Intelligence collects, why, who else handles it and what your rights are under the Protection of
        Personal Information Act, 2013 (POPIA). {COMPANY} (&ldquo;we&rdquo;) is the responsible party.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Your account:</b> your name, email address and password (stored only as a secure hash by our login provider). If you sign in with Google, we receive your name, email address and profile picture from Google, and no password.</li>
        <li><b>Your company:</b> its name, registration and contact details you enter, and the people you invite.</li>
        <li><b>Documents you upload:</b> tender documents, and compliance documents in the vault (for example tax, CSD, B-BBEE, CIPC, bank and ID documents). These can contain personal information about your directors and staff.</li>
        <li><b>What the app produces from them:</b> extracted text, checklists, AI results, questions you ask and their answers.</li>
        <li><b>Activity:</b> who changed what on a tender, reminder emails sent, and basic technical logs needed to keep the service running.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To read your tender documents and prepare checklists, answers and reminders for you: the service you signed up for.</li>
        <li>To email you reminders about closing dates, briefings and expiring documents. You can turn these off under Company profile.</li>
        <li>To keep the service secure, fix problems and tell you about changes that affect you.</li>
      </ul>
      <p>We don&rsquo;t sell your information and we don&rsquo;t use your documents to advertise to you.</p>

      <h2>Who else handles it</h2>
      <p>We use these service providers (operators under POPIA) to run the app. Each only gets what it needs for its part:</p>
      <ul>
        <li><b>Supabase:</b> database, file storage and sign-in.</li>
        <li><b>Vercel:</b> hosts the website you are using.</li>
        <li><b>Google (Gemini API):</b> receives the extracted text of a tender to produce the AI results and answer your questions. Vault documents are not sent.</li>
        <li><b>Resend:</b> sends reminder emails.</li>
      </ul>
      <p>
        Documents are read on a server we run in South Africa. Some providers above store or process data outside South Africa. Where they do, we
        rely on their contractual and security commitments to protect it to a standard comparable to POPIA.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Your documents and results stay until you delete them, or delete the tender or your account.</li>
        <li>If you try the app without an account, that trial and its documents are deleted after 7 days unless you sign up.</li>
        <li>Once a tender is submitted or closed you can remove its stored files and keep only the text and checklist.</li>
        <li>Deleted files are removed from storage within about an hour. Backups held by our providers expire on their own schedule.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Each company can only see its own data. Files are stored privately and opened only through short-lived links. Access is limited to what
        each part of the system needs. No system is perfectly secure: if a breach affects your information we will tell you and the Information
        Regulator as POPIA requires.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see the personal information we hold about you, have it corrected or deleted, or object to how we use it. Email{' '}
        <a href="mailto:info@mdakatech.com">info@mdakatech.com</a>. You can also complain to the Information Regulator (South Africa) at{' '}
        <a href="https://inforegulator.org.za" target="_blank" rel="noreferrer">inforegulator.org.za</a>.
      </p>
    </>
  );
}

function Terms() {
  return (
    <>
      <h1>Terms of use</h1>
      <p>By creating an account or using Tender Intelligence you agree to these terms on behalf of yourself and your company.</p>

      <h2>What the service does</h2>
      <p>
        Tender Intelligence reads tender documents you upload and helps you prepare a bid: it extracts key facts, lists required documents and
        disqualification rules with their source pages, answers questions from the documents and reminds you of deadlines.
      </p>

      <h2>You stay responsible for your bid</h2>
      <ul>
        <li>The AI can miss things or get them wrong. Always check each item against the tender document itself. Nothing reaches your checklist until a person confirms it.</li>
        <li>The service is not legal or procurement advice and does not tell you whether a bid is compliant or will succeed.</li>
        <li>You are responsible for meeting the issuer&rsquo;s requirements and deadlines, whatever the app shows or emails.</li>
      </ul>

      <h2>Your account and content</h2>
      <ul>
        <li>Keep your login safe and tell us if you think someone else has used it.</li>
        <li>Only upload documents you are entitled to use, and only add people who should see your company&rsquo;s data.</li>
        <li>You own your documents and results. You let us store and process them only to provide the service, as set out in the privacy notice.</li>
      </ul>

      <h2>Fair use</h2>
      <p>
        Don&rsquo;t misuse the service: no attempts to reach other companies&rsquo; data, overload it or reverse-engineer it. Limits apply, for
        example on how many questions can be asked per hour, so the service stays fast for everyone.
      </p>

      <h2>Availability and changes</h2>
      <p>
        We work to keep the service available but can&rsquo;t promise it will be uninterrupted or error-free. We may change features or these
        terms; if a change matters we will tell you in the app or by email before it applies.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we are not liable for lost tenders, lost profits or indirect losses arising from use of the service. Nothing
        in these terms limits rights you have under the Consumer Protection Act or other law that can&rsquo;t be excluded.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop using the service and ask us to delete your company&rsquo;s data at any time. We may suspend accounts that break these terms.
        These terms are governed by the law of South Africa.
      </p>
    </>
  );
}
