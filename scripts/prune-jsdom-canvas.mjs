#!/usr/bin/env node
// jsdom declares `canvas` as an optional peer dependency, and npm >=7
// auto-installs resolvable optional peers even though nothing in this repo
// needs it — jsdom runs fine without it, falling back to its built-in canvas
// stub. It only matters for local `vitest` runs (jsdom, in Node); the
// packaged Electron app never touches it (real Chromium Canvas API).
//
// Left installed, it breaks `Build & Release`: electron-builder's
// @electron/rebuild pass tries to compile it from source for Electron's ABI,
// which requires system graphics libs (cairo/pixman/pango) the GitHub
// Actions runners don't have. pdfjs-dist's own `canvas` optional dependency
// (a different major version, nested under node_modules/pdfjs-dist) ships a
// working prebuilt binary and is left alone — this only removes the
// top-level copy that jsdom's peer dependency resolves to.
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const canvasDir = path.join(root, 'node_modules', 'canvas');

if (existsSync(canvasDir)) {
  rmSync(canvasDir, { recursive: true, force: true });
  console.log('Pruned node_modules/canvas (jsdom optional peer dependency)');
}
