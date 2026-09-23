#!/usr/bin/env node
/**
 * Serve the BidSheet Field browser preview (ios/web-preview) on the local
 * network so it can be opened on a phone on the same Wi-Fi.
 *
 *   npm run field:preview            # port 5180
 *   npm run field:preview -- 8080    # another port
 *
 * No dependencies, no build step — it serves one static folder.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../ios/web-preview/', import.meta.url));
const port = Number(process.argv[2]) || 5180;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${port}/`);
  console.log('BidSheet Field preview is running.\n');
  console.log(`  On this computer:  http://localhost:${port}/`);
  for (const url of lan) console.log(`  On your phone:     ${url}`);
  if (!lan.length) console.log('  (No network address found — is this computer on Wi-Fi?)');
  console.log('\nThe phone must be on the same Wi-Fi network. Ctrl+C to stop.');
});
