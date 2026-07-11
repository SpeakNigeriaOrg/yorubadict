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

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
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
