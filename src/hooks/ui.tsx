import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

interface UiState {
  searchOpen: boolean;
  openSearch: (q?: string) => void;
  closeSearch: () => void;
  searchSeed: string;
  surpriseOpen: boolean;
  openSurprise: () => void;
  closeSurprise: () => void;
  /** markets discovered this session (Surprise Me, visits) */
  discovered: Set<string>;
  markDiscovered: (id: string) => void;
}

const Ctx = createContext<UiState | null>(null);

function loadDiscovered(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('sfa.discovered') || '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchSeed, setSearchSeed] = useState('');
  const [surpriseOpen, setSurpriseOpen] = useState(false);
  const [discovered, setDiscovered] = useState<Set<string>>(loadDiscovered);

  const openSearch = useCallback((q = '') => {
    setSearchSeed(q);
    setSearchOpen(true);
  }, []);
  const markDiscovered = useCallback((id: string) => {
    setDiscovered((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem('sfa.discovered', JSON.stringify([...next].slice(-2000)));
      } catch {
        /* storage unavailable — keep in memory */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        openSearch();
      } else if (e.key === 'r' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setSurpriseOpen(true);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setSurpriseOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSearch]);

  return (
    <Ctx.Provider
      value={{
        searchOpen,
        openSearch,
        closeSearch: () => setSearchOpen(false),
        searchSeed,
        surpriseOpen,
        openSurprise: () => setSurpriseOpen(true),
        closeSurprise: () => setSurpriseOpen(false),
        discovered,
        markDiscovered,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useUi() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useUi outside UiProvider');
  return s;
}
