import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import '../../../docs/assets/design-tokens.css';
import './global.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
