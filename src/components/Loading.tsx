export function Loading({ progress, error }: { progress: string; error?: string }) {
  return (
    <div className="loading">
      <div className="loading-orbit" aria-hidden>
        <i />
        <i />
        <i />
        <b />
      </div>
      {error ? (
        <>
          <h2>The archive is unreachable</h2>
          <p className="muted">{error}</p>
          <p className="muted small">The real-data archive is built hourly by the indexer. If it hasn’t published yet, the simulated demo is still explorable.</p>
          <div className="row gap" style={{ justifyContent: 'center' }}>
            <a className="btn primary" href="?source=demo">
              View the demo instead
            </a>
            <a className="btn ghost" href="?source=live">
              Retry live data
            </a>
          </div>
        </>
      ) : (
        <p className="loading-text">{progress}</p>
      )}
    </div>
  );
}
