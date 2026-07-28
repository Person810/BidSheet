import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

// Fix: numpad decimal not working in Chromium number inputs
document.addEventListener('keydown', (e) => {
  if (e.code === 'NumpadDecimal' && e.target instanceof HTMLInputElement) {
    e.preventDefault();
    const input = e.target;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText('.', start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
});

// A file dropped anywhere but a real dropzone must do nothing at all.
// Chromium's default action for a drop on a page is to NAVIGATE to that file,
// which for a plan PDF means losing the open bid to the built-in PDF viewer.
// The main process now refuses that navigation, but the drop should be inert
// in the first place — a mis-aimed drag is a slip, not a command.
//
// These run on the bubble phase, so a dropzone that handled the event already
// read its files by the time this fires; all this suppresses is the default.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
