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

// A module served with the wrong type is refused by the browser, and the error
// says nothing about content types. .mjs was missing here and app.js's import
// arrived as application/octet-stream.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
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

    // A directory means the page inside it. The build writes every word to
    // public/<spelling>/<word>/index.html, so /gba/take is a directory here,
    // and so is /about.
    if (st && st.isDirectory()) {
      const inside = path.join(filePath, 'index.html');
      try {
        await stat(inside);
        filePath = inside;
        st = { isDirectory: () => false };
      } catch {
        st = null;
      }
    }

    // 404, not the app shell.
    //
    // This used to answer any unknown path with index.html and a 200, which was
    // right when the whole site was one URL. It is wrong now, and quietly:
    // a missing prerendered page would have looked like a working one, and a
    // typo would answer 200 with an empty shell - a soft 404, which a crawler
    // reads as a real page. Cloudflare Pages serves its own 404 for a path with
    // no file, so this matches what deployment does.
    if (!st) {
      const notFound = await readFile(path.join(publicDir, 'index.html')).catch(() => null);
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        notFound
          ? `<!doctype html><meta charset="utf-8"><title>Not found</title>` +
              `<p>Nothing is served at <code>${urlPath.replace(/[<&]/g, '')}</code>.` +
              `<p><a href="/">Back to the dictionary</a>`
          : 'Not found'
      );
      return;
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
  console.log(`Sọ̀rọ̀ Sókè — The People’s Yorùbá Dictionary — running at http://localhost:${port}`);
});
