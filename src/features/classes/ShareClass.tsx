import { useState } from 'react';
import { joinLink } from '@/services/classes';
import { useToast } from '@/hooks/useToast';

/** Join link + code, with copy, WhatsApp broadcast, and native share. */
export function ShareClass({ code, classNameLabel }: { code: string; classNameLabel?: string }) {
  const toast = useToast();
  const link = joinLink(code);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast('Student join link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy. Select the link and copy it manually.', 'error');
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast(`Join code ${code} copied`);
    } catch {
      toast('Could not copy code.', 'error');
    }
  };

  const shareWhatsApp = () => {
    const title = classNameLabel ? `*${classNameLabel}* — CampusPulse Attendance` : 'CampusPulse Attendance';
    const msg = `${title}\nClaim your student attendance profile once using your Name & Matric Number:\n${link}\nClass Code: *${code}*`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'Join class on CampusPulse', text: `Class code: ${code}`, url: link });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') void copy();
    }
  };

  return (
    <div className="share">
      <div className="share-text">
        <span className="share-label">Student Enrollment Link</span>
        <span className="share-link mono">{link}</span>
        <span className="muted small">
          Class Code <strong className="mono">{code}</strong> — share in your class WhatsApp group so students claim once.
        </span>
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" onClick={copy}>
          <span>{copied ? 'Copied!' : 'Copy link'}</span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={shareWhatsApp}>
          <span>WhatsApp group</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copyCode}>
          <span>Copy code</span>
        </button>
        {typeof navigator.share === 'function' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={share}>
            <span>Share</span>
          </button>
        )}
      </div>
    </div>
  );
}
