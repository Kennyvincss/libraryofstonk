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
          <p className="muted small">Check VITE_DATA_SOURCE / VITE_ARCHIVE_API_URL, or run with VITE_DATA_SOURCE=demo.</p>
        </>
      ) : (
        <p className="loading-text">{progress}</p>
      )}
    </div>
  );
}
