import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initMobileGuard } from './lib/mobileGuard';
import './styles/global.css';

initMobileGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
