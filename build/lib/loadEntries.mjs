// build/lib/loadEntries.mjs
//
// Loads the canonical artifact published by the kaikki-yoruba repo - either
// a local file (offline dev/testing, or pinning to a specific snapshot) or
// the latest GitHub Release (the normal path: kaikki-yoruba publishes a
// fresh release on its own schedule, "latest" is always the one to use).
// Ported from yoruba_student_dict_platform/ingest/src/loadEntries.ts, same
// logic, no TypeScript types.

import { readFile } from 'node:fs/promises';

export async function loadEntriesFromFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export const KAIKKI_YORUBA_REPO = 'https://github.com/SpeakNigeriaOrg/kaikki-yoruba';
export const KAIKKI_YORUBA_LATEST_RELEASE_URL = `${KAIKKI_YORUBA_REPO}/releases/latest`;

export class ArtifactAssetNotFoundError extends Error {
  constructor(assetName) {
    super(`kaikki-yoruba's latest release has no asset named '${assetName}'`);
    this.name = 'ArtifactAssetNotFoundError';
  }
}

// Deliberately not api.github.com.
//
// This used to resolve the release through the API, which allows 60 requests
// an hour to an unauthenticated caller and counts them per IP. On Cloudflare
// Pages that IP belongs to the build fleet rather than to us, so a deploy
// competed with every other project building at the same moment - and lost, on
// 2026-09-09, failing at step 1 of 5 and leaving the site on the previous
// commit.
//
// The fix was going to be a token. But the API was never needed: every release
// exposes /releases/latest/download/<asset> as an ordinary redirect to the
// asset, and /releases/latest itself redirects to /releases/tag/<tag>, which is
// where the tag name comes from below. Neither path is rate limited, so there
// is no token to create, store, rotate, or discover has expired two years from
// now.
const assetUrl = (name) => `${KAIKKI_YORUBA_LATEST_RELEASE_URL}/download/${name}`;

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, { headers: { 'User-Agent': 'yorubadict-build' } });

  // A failed fetch here costs a whole deploy, and GitHub's asset host has its
  // own bad minutes. Three tries with a widening pause turns most of them into
  // a slow build rather than a red one.
  if (response.status >= 500 && attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 5000));
    return fetchJson(url, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** The tag of the current release, read off the redirect that /releases/latest
 * performs to /releases/tag/<tag>. It names the data in the build stamp and the
 * validation report, so a rebuilt site can always say which release it came
 * from. A redirect that stops carrying the tag is not fatal - the build stamp
 * falls back to "local" - so this returns null rather than throwing. */
async function resolveLatestTag() {
  try {
    const response = await fetch(KAIKKI_YORUBA_LATEST_RELEASE_URL, {
      redirect: 'follow',
      headers: { 'User-Agent': 'yorubadict-build' },
    });
    const match = /\/releases\/tag\/([^/?#]+)/.exec(response.url);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export async function loadLatestEntriesAndMetadata() {
  const [entries, metadata, tagName] = await Promise.all([
    fetchJson(assetUrl('entries.json')),
    fetchJson(assetUrl('metadata.json')),
    resolveLatestTag(),
  ]);
  return { tagName, entries, metadata };
}
