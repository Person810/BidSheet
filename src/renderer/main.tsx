import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

// Fix: numpad decimal not working in Chromium number inputs
document.addEventListener('keydown', (e) => {
  if (e.code === 'NumpadDecimal' && e.target instanceof HTMLInputElement) {
    e.preventDefault();
    document.execCommand('insertText', false, '.');
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
