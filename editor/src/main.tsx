import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { DesignPage } from './DesignPage';
import { Home } from './screens/Home';
import { Editor } from './screens/Editor';
import { ExportScreen } from './screens/ExportScreen';
import './index.css';

const subscribe = (cb: () => void) => {
  addEventListener('hashchange', cb);
  return () => removeEventListener('hashchange', cb);
};

function App() {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  const [, route, id] = hash.split('/');
  if (hash === '#/design') return <DesignPage />;
  if (route === 'edit' && id) return <Editor id={id} />;
  if (route === 'export' && id) return <ExportScreen id={id} />;
  return <Home mode={route === 'thumbs' ? 'thumbs' : 'clips'} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
