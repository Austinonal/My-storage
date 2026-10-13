import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignPage } from './DesignPage';
import './index.css';

const subscribe = (cb: () => void) => {
  addEventListener('hashchange', cb);
  return () => removeEventListener('hashchange', cb);
};

function App() {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  if (hash === '#/design') return <DesignPage />;
  return (
    <main className="grid min-h-dvh place-items-center p-4 text-center text-muted">
      <p>
        The editor is built in /replica-build. <a href="#/design" className="text-accent underline">Design system</a>
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
