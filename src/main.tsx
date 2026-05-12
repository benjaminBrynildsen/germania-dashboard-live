import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// Body: Geist Sans (variable) — modern w/ warmth, replaces Inter as
// the default surface font.
import '@fontsource-variable/geist';
// Display: Fraunces (variable) — slightly old-world serif with optical
// sizes; pairs with the blackletter Germania logo without becoming
// unreadable at small sizes.
import '@fontsource-variable/fraunces';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
