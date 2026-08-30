// tools/trace/cdp.mjs
//
// A Chrome DevTools Protocol client in about a hundred lines, with no
// dependencies.
//
// The obvious way to do this is puppeteer or lighthouse, and both are the
// wrong shape for this repo: package.json has no dependencies at all, the
// README's whole argument is that the site has no build step, and adding
// ~200 MB of node_modules to answer one timing question would be the tail
// wagging the dog. Node 22 shipped a global WebSocket, which is the only
// thing puppeteer was needed for here - everything below is JSON over that
// socket.
//
// What this deliberately does NOT do is reimplement Lighthouse. There is no
// scoring, no Lantern simulation, no audit list. It records a real trace under
// controlled emulation and hands back the events. The analysis lives in
// paint-profile.mjs.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// CHROME_PATH first so CI or a Chromium install can override without a code
// change. The rest is a short list rather than a search: if none of these
// exist the caller gets a clear message and skips, which is better than a
// twenty-second filesystem walk ending in the same place.
export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin') return MAC_CHROME;
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  }
  return '/usr/bin/google-chrome';
}

export async function chromeAvailable() {
  try {
    const { access } = await import('node:fs/promises');
    await access(chromePath());
    return true;
  } catch {
    return false;
  }
}

export async function launchChrome({ headless = true, gpu = false } = {}) {
  // A fresh profile per launch, which is not tidiness: the service worker in
  // public/sw.js precaches the whole dictionary, so a reused profile would
  // make the second run of any experiment a warm-cache run and quietly
  // invalidate the comparison. Every run here is a first visit unless the
  // caller asks for a reload.
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'soro-trace-'));

  const args = [
    // Port 0 means "pick one" - hardcoding 9222 collides with any Chrome the
    // developer already has open with debugging on.
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--mute-audio',
    // Otherwise the renderer for a backgrounded headless tab is throttled and
    // every timing measured here is a measurement of the throttler.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');
  if (!gpu) args.unshift('--disable-gpu');

  const proc = spawn(chromePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });

  // Chrome writes the port it actually took into DevToolsActivePort once the
  // socket is up. Polling that file is the documented way to find it.
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  let port = null;
  for (let i = 0; i < 100 && port === null; i++) {
    await sleep(100);
    try {
      const [line] = (await readFile(portFile, 'utf8')).split('\n');
      if (line) port = Number(line);
    } catch {
      /* not written yet */
    }
  }
  if (!port) {
    proc.kill('SIGKILL');
    await rm(userDataDir, { recursive: true, force: true });
    throw new Error('Chrome did not report a debugging port');
  }

  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  const { webSocketDebuggerUrl } = await res.json();

  return {
    proc,
    port,
    webSocketDebuggerUrl,
    async close() {
      proc.kill('SIGKILL');
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

// One socket, many sessions. Commands carry a sessionId to reach a page;
// omitting it addresses the browser itself, which is where Tracing lives -
// tracing is process-wide, and the raster threads this is looking for are not
// in the renderer's session at all.
export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => this.#onMessage(ev.data));
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)), {
        once: true,
      });
    });
    return new Cdp(ws);
  }

  #onMessage(raw) {
    const msg = JSON.parse(raw);
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`));
      else entry.resolve(msg.result);
      return;
    }
    // Events are keyed by method alone, not by session. Nothing here runs two
    // pages at once, and keying by session would mean every listener had to be
    // registered after the attach that produced its id.
    for (const fn of this.listeners.get(msg.method) || []) fn(msg.params, msg.sessionId);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
    return () => {
      const arr = this.listeners.get(method);
      arr.splice(arr.indexOf(fn), 1);
    };
  }

  // Resolves on the first event matching `predicate`, or rejects on timeout.
  // The timeout is not optional anywhere it is used: a paint that never
  // arrives is one of the outcomes this tool is looking for, and a hung
  // promise reports it as a hung test instead of a slow page.
  once(method, predicate = () => true, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params) => {
        if (!predicate(params)) return;
        off();
        clearTimeout(timer);
        resolve(params);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    this.ws.close();
  }
}
