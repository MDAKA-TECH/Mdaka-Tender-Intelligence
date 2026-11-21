import { useState, type DragEvent } from 'react';
import { CalendarClock, FileSearch, MessageSquareText, Sparkles, Upload } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { TENDER_FILE_ACCEPT, checkTenderFile } from '../lib/tenderFiles';
import { usePageTitle } from '../components/ui';

// What a visitor sees first: upload a tender (or the sample) straight away. No sign-up until they
// want to keep it, add more, or get reminders.
export default function GuestStart() {
  usePageTitle(null);
  const { startAsGuest, guestError } = useAuth();
  const [pickError, setPickError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const take = (list: FileList | null) => {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, 6);
    const bad = files.map(checkTenderFile).filter(Boolean) as string[];
    const ok = files.filter((f) => !checkTenderFile(f));
    setPickError(bad.length ? bad.join(' ') : null);
    if (ok.length) startAsGuest(ok);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files);
  };

  return (
    <div className="guest-start">
      <header className="gs-top">
        <div className="gs-brand">
          <img src="/favicon.svg" alt="" width="36" height="36" />
          <b>Tender <span>Intelligence</span></b>
        </div>
        <a className="btn gs-signin" href="#/signin">Sign in</a>
      </header>

      <main className="gs-main">
        <div className="gs-hero">
          <p className="gs-kicker">For South African businesses that bid on tenders</p>
          <h1>Turn any tender into a checklist, in about a minute.</h1>
          <p className="gs-lead">
            Upload the tender pack. Get every deadline, returnable document and disqualification rule, each with the page it came from.
          </p>
        </div>

        <label
          className={`gs-drop ${dragging ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload className="ico gs-drop-ico" aria-hidden="true" />
          <b>Upload your tender</b>
          <span className="muted">PDF or Word: the main document, annexures and SBD forms. Drop them here or click to choose.</span>
          <span className="btn primary">Choose documents</span>
          <input type="file" accept={TENDER_FILE_ACCEPT} multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
        </label>
        <div className="gs-or">
          <span className="muted">No tender handy?</span>
          <button className="btn" onClick={() => startAsGuest('sample')}><Sparkles className="ico" aria-hidden="true" />Try a sample tender</button>
        </div>
        {(pickError || guestError) && <div className="callout crit gs-error">{pickError || guestError}</div>}
        <p className="small muted gs-free">Free to try. No account needed until you want to keep your work.</p>

        <ul className="gs-features">
          <li><FileSearch className="ico" aria-hidden="true" /><div><b>Every page read</b><span>Scanned pages too. Each item links to the exact page and wording.</span></div></li>
          <li><MessageSquareText className="ico" aria-hidden="true" /><div><b>Ask anything</b><span>"Is the briefing compulsory?" Answered from the documents, with the page.</span></div></li>
          <li><CalendarClock className="ico" aria-hidden="true" /><div><b>Never miss a deadline</b><span>Reminders before closing dates, briefings and expiring documents.</span></div></li>
        </ul>
      </main>

      <footer className="gs-foot small muted">
        By Mdaka Advanced Technologies · <a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a>
      </footer>
    </div>
  );
}
