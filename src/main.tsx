import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ArchiveProvider, LiveProvider } from './hooks/archive';
import { UiProvider } from './hooks/ui';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/mobile.css';
import './styles/simple.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ArchiveProvider>
        <LiveProvider>
          <UiProvider>
            <App />
          </UiProvider>
        </LiveProvider>
      </ArchiveProvider>
    </BrowserRouter>
  </StrictMode>,
);
