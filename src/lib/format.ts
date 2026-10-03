const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtUsd(v: number, digits?: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits ?? (a >= 1e10 ? 1 : 2))}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(digits ?? (a >= 1e7 ? 1 : 2))}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(digits ?? (a >= 1e4 ? 0 : 1))}K`;
  if (a >= 1) return `${s}$${a.toFixed(digits ?? 0)}`;
  return `${s}$${a.toFixed(2)}`;
}

/** Tiny token prices in subscript-zero notation: $0.0₄123 = $0.0000123. */
export function fmtPrice(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  let zeros = Math.floor(-Math.log10(v));
  let digits = Math.round(v * Math.pow(10, zeros + 3));
  if (digits >= 1000) {
    // rounding carried into the next decade (e.g. 0.00009999)
    zeros -= 1;
    digits = 100;
  }
  const sub = String(zeros)
    .split('')
    .map((d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])
    .join('');
  return `$0.0${sub}${digits}`;
}

export function fmtQuotePrice(v: number, quote: string): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${fmtPrice(v).slice(1)} ${quote}`;
}

export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  if (v >= 1e5) return `${Math.round(v / 1e3)}K`;
  return Math.round(v).toLocaleString('en-US');
}

export function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—';
  const p = v * 100;
  const d = Math.abs(p) >= 1000 ? 0 : digits;
  return `${p >= 0 ? '+' : ''}${p.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
}

export function fmtMultiple(x: number): string {
  if (x >= 100) return `${Math.round(x).toLocaleString('en-US')}×`;
  if (x >= 10) return `${x.toFixed(0)}×`;
  return `${x.toFixed(1)}×`;
}

/** Peak move as a percentage, e.g. +4,821% */
export function fmtPeakMove(launch: number, ath: number): string {
  return fmtPct(ath / launch - 1, 0);
}

export function fmtDate(t: number, opts: { year?: boolean } = {}): string {
  const d = new Date(t);
  const s = `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return opts.year === false ? s : `${s}, ${d.getUTCFullYear()}`;
}

export function fmtDateShort(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function fmtDateTime(t: number): string {
  const d = new Date(t);
  return `${fmtDateShort(t)} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

export function fmtMonth(t: number, long = false): string {
  const d = new Date(t);
  return `${(long ? MONTHS_LONG : MONTHS)[d.getUTCMonth()]}${long ? ' ' : ' '}${d.getUTCFullYear()}`;
}

export function monthLabel(i: number) {
  return MONTHS[i];
}

export function fmtDuration(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
  if (h < 48) return `${Math.round(h)} hours`;
  const d = h / 24;
  if (d < 60) return `${Math.round(d)} days`;
  return `${Math.round(d / 30)} months`;
}

export function fmtAgo(t: number, now = Date.now()): string {
  const s = (now - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 60) return `${d} days ago`;
  return `${Math.floor(d / 30)} months ago`;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}
