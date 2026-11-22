import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted open-source Bahnschrift/DIN-inspired typography (Barlow & Barlow Semi Condensed) + JetBrains Mono
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import { App } from './App';

// Conditional feature-detected polyfills per modern-web-guidance (never loaded unconditionally)
if (typeof window !== 'undefined') {
  if (!('switch' in HTMLInputElement.prototype)) {
    void import('input-switch-polyfill');
  }
  if (!Object.hasOwn(HTMLElement.prototype, 'popover')) {
    void import('@oddbird/popover-polyfill');
  }
  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    void import('invokers-polyfill');
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
