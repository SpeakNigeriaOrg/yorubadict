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

export const KAIKKI_YORUBA_LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/SpeakNigeriaOrg/kaikki-yoruba/releases/latest';

export class ArtifactAssetNotFoundError extends Error {
  constructor(assetName) {
    super(`kaikki-yoruba's latest release has no asset named '${assetName}'`);
    this.name = 'ArtifactAssetNotFoundError';
  }
}

// GitHub's API allows 60 requests an hour to an unauthenticated caller, counted
// per IP - and on Cloudflare Pages that IP is shared with every other project
// building at the same time. A deploy of this repo has exactly one job that
// touches the API, and it still lost that race on 2026-09-09:
//
//   [1/5] Fetching kaikki-yoruba's latest release ...
//   Build failed: 403 rate limit exceeded
//
// A token raises the ceiling to 5,000 an hour and makes the limit ours rather
// than the build fleet's. Set GITHUB_TOKEN in the Pages project's environment
// variables; the repo is public, so it needs no scopes at all - it is proof of
// identity, not permission. Without one this still works, just fragilely.
function githubHeaders() {
  // A User-Agent is not optional to GitHub's API: it rejects requests without
  // one, and Node's fetch does not send a default.
  const headers = { 'User-Agent': 'yorubadict-build', Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, { headers: githubHeaders() });

  // Rate limiting and GitHub's occasional 5xx are transient, and a failed
  // build here costs a whole deploy. Three tries with a widening pause turns
  // most of them into a slow build instead of a red one. A limit that is
  // genuinely exhausted still fails, which is what the token is for.
  const transient = response.status === 403 || response.status === 429 || response.status >= 500;
  if (transient && attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 5000));
    return fetchJson(url, attempt + 1);
  }

  if (!response.ok) {
    const hint =
      transient && !process.env.GITHUB_TOKEN
        ? ' - set GITHUB_TOKEN in the build environment to raise the rate limit'
        : '';
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}${hint}`);
  }
  return response.json();
}

/** Resolves entries.json/metadata.json download URLs from kaikki-yoruba's
 * latest GitHub Release, rather than a hardcoded path - each run publishes
 * a fresh release, so "latest" is always the right one to consume. */
export async function resolveLatestArtifactUrls() {
  const release = await fetchJson(KAIKKI_YORUBA_LATEST_RELEASE_API_URL);

  const entriesAsset = release.assets.find((a) => a.name === 'entries.json');
  if (!entriesAsset) throw new ArtifactAssetNotFoundError('entries.json');
  const metadataAsset = release.assets.find((a) => a.name === 'metadata.json');
  if (!metadataAsset) throw new ArtifactAssetNotFoundError('metadata.json');

  return { tagName: release.tag_name, entriesUrl: entriesAsset.browser_download_url, metadataUrl: metadataAsset.browser_download_url };
}

export async function loadLatestEntriesAndMetadata() {
  const { tagName, entriesUrl, metadataUrl } = await resolveLatestArtifactUrls();
  const [entries, metadata] = await Promise.all([fetchJson(entriesUrl), fetchJson(metadataUrl)]);
  return { tagName, entries, metadata };
}
