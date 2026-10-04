import { useEffect, useRef, useState } from 'react';

export const TIP_ADDRESS = '6Luwhv6b86y8gtvcb3ZM9R72QkhL94raHsJCjDCqcpgE';

/** "Tip the creator": a small nav tab that opens the Solana address with a copy button. */
export function TipJar() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TIP_ADDRESS);
    } catch {
      // older browsers: select-and-copy fallback
      const t = document.createElement('textarea');
      t.value = TIP_ADDRESS;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="tip" ref={ref}>
      <button className={`tip-tab ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        <span aria-hidden>♥</span>
        <span className="tip-label">Tip the creator</span>
      </button>
      {open && (
        <div className="tip-pop" role="dialog" aria-label="Tip the creator">
          <div className="tip-head">Tip the creator</div>
          <p className="tip-note">Enjoying the archive? Send any amount of SOL or tokens on Solana.</p>
          <div className="tip-addr">
            <code>{TIP_ADDRESS}</code>
          </div>
          <button className="btn primary sm tip-copy" onClick={copy}>
            {copied ? '✓ Copied' : 'Copy address'}
          </button>
        </div>
      )}
    </div>
  );
}
