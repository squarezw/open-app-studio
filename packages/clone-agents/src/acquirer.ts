import type { InteractionFlowGraph } from '@oas/flow-graph';

/** Stage 0 — resolve a store URL into something we can run or, failing that, infer from. */

export interface StoreRef {
  platform: 'ios' | 'android';
  /** iTunes numeric id (ios) or package name (android). */
  appId: string;
  country: string;
  storeUrl: string;
}

export interface StoreMetadata {
  platform: 'ios' | 'android';
  appId: string;
  name: string;
  description?: string;
  category?: string;
  iconUrl?: string;
  screenshots: string[];
  storeUrl: string;
}

const APP_STORE_RE = /^https?:\/\/(?:apps|itunes)\.apple\.com\/(?:([a-z]{2})\/)?app\/(?:[^/]+\/)?id(\d+)/i;
const PLAY_RE = /^https?:\/\/play\.google\.com\/store\/apps\/details/i;

export function parseStoreUrl(url: string): StoreRef {
  const appStore = APP_STORE_RE.exec(url);
  if (appStore) {
    return { platform: 'ios', appId: appStore[2]!, country: appStore[1] ?? 'us', storeUrl: url };
  }
  if (PLAY_RE.test(url)) {
    const id = new URL(url).searchParams.get('id');
    if (!id) throw new Error(`Play Store URL missing ?id= package name: ${url}`);
    return { platform: 'android', appId: id, country: new URL(url).searchParams.get('gl') ?? 'us', storeUrl: url };
  }
  throw new Error(`Not a recognizable App Store / Google Play URL: ${url}`);
}

export interface FetchMetadataOptions {
  fetchImpl?: typeof fetch;
}

export async function fetchStoreMetadata(ref: StoreRef, opts: FetchMetadataOptions = {}): Promise<StoreMetadata> {
  const doFetch = opts.fetchImpl ?? fetch;
  if (ref.platform === 'ios') {
    const res = await doFetch(`https://itunes.apple.com/lookup?id=${ref.appId}&country=${ref.country}`);
    if (!res.ok) throw new Error(`iTunes lookup failed: HTTP ${res.status}`);
    const data = (await res.json()) as {
      resultCount: number;
      results: Array<{
        trackName?: string;
        bundleId?: string;
        description?: string;
        primaryGenreName?: string;
        artworkUrl512?: string;
        artworkUrl100?: string;
        screenshotUrls?: string[];
      }>;
    };
    const app = data.results?.[0];
    if (!data.resultCount || !app) throw new Error(`No App Store app found for id ${ref.appId}`);
    return {
      platform: 'ios',
      appId: app.bundleId ?? ref.appId,
      name: app.trackName ?? `app ${ref.appId}`,
      description: app.description,
      category: app.primaryGenreName,
      iconUrl: app.artworkUrl512 ?? app.artworkUrl100,
      screenshots: app.screenshotUrls ?? [],
      storeUrl: ref.storeUrl,
    };
  }

  // Google Play has no public metadata API; best-effort scrape of the listing page.
  const res = await doFetch(ref.storeUrl);
  if (!res.ok) throw new Error(`Play listing fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const name =
    /<meta property="og:title" content="([^"]+?)(?: - Apps on Google Play)?"/.exec(html)?.[1] ??
    /<title[^>]*>([^<]+?)(?: - Apps on Google Play)?<\/title>/.exec(html)?.[1] ??
    ref.appId;
  const iconUrl = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1];
  const screenshots = [...html.matchAll(/https:\/\/play-lh\.googleusercontent\.com\/[\w\-=]+/g)]
    .map((m) => m[0])
    .filter((u, i, all) => all.indexOf(u) === i)
    .slice(0, 10);
  return {
    platform: 'android',
    appId: ref.appId,
    name,
    description,
    iconUrl,
    screenshots,
    storeUrl: ref.storeUrl,
  };
}

/**
 * Metadata-only fallback: when we can't install the app (iOS without a device,
 * region locks), produce a *provisional* IFG from store screenshots — clearly
 * marked `platform: "inferred"`, nodes only, for the user to review in Studio.
 */
export function provisionalIfgFromMetadata(meta: StoreMetadata): InteractionFlowGraph {
  const nodes = meta.screenshots.slice(0, 10).map((url, i) => ({
    id: `n_${i + 1}`,
    fingerprint: `inferred:s${i + 1}`,
    title: `Store screenshot ${i + 1}`,
    role: 'other' as const,
    evidence: [{ type: 'screenshot' as const, ref: url }],
    visits: 0,
  }));
  return {
    version: '0.1',
    meta: {
      appName: meta.name,
      appId: meta.appId,
      storeUrl: meta.storeUrl,
      platform: 'inferred',
      coverage: { nodes: nodes.length, edges: 0, frontier: 0, blocked: 0, actions: 0 },
    },
    nodes,
    edges: [],
    flows: [],
    frontier: [],
  };
}
