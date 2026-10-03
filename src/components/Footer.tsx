import { Link } from 'react-router-dom';
import { useArchive } from '../hooks/archive';
import { fmtDate } from '../lib/format';

export function Footer() {
  const { archive } = useArchive();
  return (
    <footer className="footer">
      <div className="logo-text">
        STONKFUN<b>ARCHIVE</b>
      </div>
      <p className="muted small">
        An independent, exploratory history of the StonkFun ecosystem. Not affiliated with StonkFun. Not financial advice.
        <br />
        Data: {archive.meta.label} · {fmtDate(archive.meta.archiveStart)} → {fmtDate(archive.meta.archiveEnd)}
        {archive.meta.isDemo && (
          <>
            {' '}
            · <Link to="/about#data">numbers are simulated</Link>
          </>
        )}
      </p>
    </footer>
  );
}
