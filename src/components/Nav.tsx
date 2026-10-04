import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useUi } from '../hooks/ui';
import { DemoChip } from './bits';
import { TipJar } from './TipJar';
import { StonkMark } from './StonkMark';

const LINKS = [
  ['/universe', 'Universe'],
  ['/moments', 'Moments'],
  ['/explore', 'Explore'],
  ['/legends', 'Legends'],
  ['/about', 'About'],
] as const;

export function Nav() {
  const { openSearch, openSurprise } = useUi();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const overlay = loc.pathname === '/' || loc.pathname === '/universe' || loc.pathname === '/rewind';
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={`nav ${overlay ? 'overlay' : ''} ${overlay && scrolled ? 'solid' : ''}`}>
      <Link to="/" className="logo" onClick={() => setOpen(false)}>
        <span className="logo-mark" aria-hidden>
          <span className="logo-orbit" />
          <StonkMark size={15} />
        </span>
        <span className="logo-text">
          STONKFUN<b>ARCHIVE</b>
        </span>
      </Link>
      <nav className={`nav-links ${open ? 'open' : ''}`} aria-label="Primary">
        {LINKS.map(([to, label]) => (
          <NavLink key={to} to={to} onClick={() => setOpen(false)}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="nav-right">
        <DemoChip />
        <TipJar />
        <button className="nav-search" onClick={() => openSearch()} aria-label="Search the archive">
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>Search</span>
          <kbd>/</kbd>
        </button>
        <button className="nav-dice" onClick={openSurprise} title="Surprise me (R)" aria-label="Surprise me">
          🎲
        </button>
        <button className="nav-burger" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}
