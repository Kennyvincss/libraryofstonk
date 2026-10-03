import { Link } from 'react-router-dom';
import { useUi } from '../hooks/ui';

export function NotFound({ what = 'page' }: { what?: string }) {
  const { openSurprise } = useUi();
  return (
    <div className="notfound">
      <div className="nf-void" aria-hidden />
      <h1>Lost in space</h1>
      <p className="muted">This {what} isn’t in the archive. Maybe it never existed. Maybe it rugged.</p>
      <div className="row gap">
        <Link to="/universe" className="btn primary">
          Back to the universe
        </Link>
        <button className="btn ghost" onClick={openSurprise}>
          🎲 Surprise me
        </button>
      </div>
    </div>
  );
}
