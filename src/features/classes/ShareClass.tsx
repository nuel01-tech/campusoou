import { useState } from 'react';
import { joinLink } from '@/services/classes';
import { useToast } from '@/hooks/useToast';

/** Join link + code, with copy and native share where available. */
export function ShareClass({ code }: { code: string }) {
  const toast = useToast();
  const link = joinLink(code);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy. Select the link and copy it manually.', 'error');
    }
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
        <span className="share-label">Student link</span>
        <span className="share-link mono">{link}</span>
        <span className="muted small">
          Code <strong className="mono">{code}</strong> — post it in the class group.
        </span>
      </div>
      <div className="row">
        <button className="btn btn-secondary btn-sm" onClick={copy}>
          <span>{copied ? 'Copied' : 'Copy link'}</span>
        </button>
        {typeof navigator.share === 'function' && (
          <button className="btn btn-ghost btn-sm" onClick={share}>
            <span>Share</span>
          </button>
        )}
      </div>
    </div>
  );
}
