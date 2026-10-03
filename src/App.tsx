import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useArchiveState } from './hooks/archive';
import { Nav } from './components/Nav';
import { SearchOverlay } from './components/SearchOverlay';
import { SurpriseModal } from './components/SurpriseModal';
import { Loading } from './components/Loading';
import { Home } from './pages/Home';
import { UniversePage } from './pages/UniversePage';
import { MomentsPage } from './pages/MomentsPage';
import { MomentPage } from './pages/MomentPage';
import { ExplorePage } from './pages/ExplorePage';
import { LegendsPage } from './pages/LegendsPage';
import { MarketPage } from './pages/MarketPage';
import { ConstellationPage } from './pages/ConstellationPage';
import { AboutPage } from './pages/AboutPage';
import { NotFound } from './pages/NotFound';
import { RewindPage } from './pages/RewindPage';

export function App() {
  const { status, progress, error } = useArchiveState();
  const loc = useLocation();
  useEffect(() => {
    if (!loc.hash) window.scrollTo({ top: 0 });
  }, [loc.pathname, loc.hash]);

  return (
    <>
      <Nav />
      {status !== 'ready' ? (
        <Loading progress={progress} error={error} />
      ) : (
        <>
          <main className="page" key={loc.pathname}>
            <Routes location={loc}>
              <Route path="/" element={<Home />} />
              <Route path="/universe" element={<UniversePage />} />
              <Route path="/moments" element={<MomentsPage />} />
              <Route path="/moments/:id" element={<MomentPage />} />
              <Route path="/explore" element={<ExplorePage />} />
              <Route path="/explore/:tab" element={<ExplorePage />} />
              <Route path="/legends" element={<LegendsPage />} />
              <Route path="/market/:id" element={<MarketPage />} />
              <Route path="/c/:kind/:key" element={<ConstellationPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/rewind" element={<RewindPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <SearchOverlay />
          <SurpriseModal />
        </>
      )}
    </>
  );
}
