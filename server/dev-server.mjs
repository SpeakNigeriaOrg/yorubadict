#!/usr/bin/env node
// server/dev-server.mjs
//
// A minimal static file server for LOCAL DEVELOPMENT ONLY.
//
// This app is designed to deploy to Cloudflare Pages (or any static host)
// with zero server-side logic. This script exists purely because browsers
// block fetch() against file:// URLs (CORS), so `public/` needs to be
// served over http:// to test locally. It is not part of the deployed
// application and has no server-side routing beyond "serve the file."

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const port = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(publicDir, urlPath);

    // Prevent path traversal outside public/
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    let st;
    try {
      st = await stat(filePath);
    } catch {
      st = null;
    }

    if (!st || st.isDirectory()) {
      filePath = path.join(publicDir, 'index.html');
    }

    const ext = path.extname(filePath);
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500);
    res.end('Server error: ' + err.message);
  }
});

server.listen(port, () => {
  console.log(`Ọ̀rọ̀ (The Yoruba Dictionary) running at http://localhost:${port}`);
});
