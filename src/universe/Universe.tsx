import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useArchive, useLive } from '../hooks/archive';
import { UniverseRenderer, type Camera, type UniverseMode } from './renderer';
import type { UNode } from './layout';
import { HoverCard } from '../components/HoverCard';

export interface UniverseProps {
  mode: UniverseMode;
  highlight?: string[] | null;
  fitHighlight?: boolean;
  filter?: ((n: UNode) => boolean) | null;
  activity?: { at: number; map: Map<string, number> } | null;
  focusId?: string | null;
  focusCluster?: string | null;
  onSelect?: (n: UNode) => void;
  onCamera?: (c: Camera) => void;
  controls?: boolean;
  className?: string;
  initialZoom?: number;
  /** change this value to fly back to the full view */
  fitKey?: string | number;
}

export function Universe({ mode, highlight, fitHighlight, filter, activity, focusId, focusCluster, onSelect, onCamera, controls, className, initialZoom, fitKey }: UniverseProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<UniverseRenderer | null>(null);
  const { layout, archive } = useArchive();
  const nav = useNavigate();
  const live = useLive();
  const [hover, setHover] = useState<{ n: UNode; x: number; y: number } | null>(null);
  const cb = useRef({ onSelect, onCamera });
  cb.current = { onSelect, onCamera };

  useEffect(() => {
    const ren = new UniverseRenderer(ref.current!, mode);
    r.current = ren;
    ren.setLayout(layout);
    ren.fit(true, initialZoom ?? 1);
    ren.on({
      hover: (n, x, y) => setHover(n ? { n, x, y } : null),
      click: (n) => (cb.current.onSelect ? cb.current.onSelect(n) : nav(`/market/${n.id}`)),
      camera: (c) => cb.current.onCamera?.(c),
    });
    return () => {
      ren.destroy();
      r.current = null;
    };
    // the renderer lives for the component's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => r.current?.setMode(mode), [mode]);
  useEffect(() => {
    if (fitKey !== undefined) r.current?.fit(false, initialZoom ?? 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  useEffect(() => r.current?.setHighlight(highlight ?? null, fitHighlight), [highlight, fitHighlight]);
  useEffect(() => r.current?.setFilter(filter ?? null), [filter]);
  useEffect(() => r.current?.setActivity(activity?.at ?? null, activity?.map ?? null), [activity]);
  useEffect(() => {
    if (focusId) r.current?.focusNode(focusId);
  }, [focusId]);
  useEffect(() => {
    // a '#nonce' suffix lets callers re-trigger a fly-to to the same cluster
    if (focusCluster) r.current?.focusCluster(focusCluster.split('#')[0]);
  }, [focusCluster]);
  useEffect(
    () =>
      live.listen((e) => {
        if (e.marketId) r.current?.pulse(e.marketId, e.kind === 'launch' ? '#5ee7ff' : e.kind === 'unusual' ? '#ff4fa3' : '#d4ff3a');
      }),
    [live],
  );

  const market = hover ? archive.markets[hover.n.i] : undefined;
  return (
    <div className={`universe ${className ?? ''}`}>
      <canvas ref={ref} className="universe-canvas" aria-label="Interactive universe of StonkFun markets. Drag to pan, scroll to zoom, click a star to open its market." />
      {market && hover && <HoverCard market={market} x={hover.x} y={hover.y} />}
      {controls && (
        <div className="u-controls" role="group" aria-label="Zoom controls">
          <button onClick={() => r.current && r.current.flyTo(r.current.cam.x, r.current.cam.y, r.current.cam.z * 1.6)} aria-label="Zoom in">+</button>
          <button onClick={() => r.current && r.current.flyTo(r.current.cam.x, r.current.cam.y, r.current.cam.z / 1.6)} aria-label="Zoom out">−</button>
          <button onClick={() => r.current?.fit()} aria-label="Show everything" title="Show everything">◎</button>
        </div>
      )}
    </div>
  );
}
