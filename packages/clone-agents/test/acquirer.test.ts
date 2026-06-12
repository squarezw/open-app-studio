import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { fetchStoreMetadata, parseStoreUrl, provisionalIfgFromMetadata } from '../src/acquirer.js';

describe('parseStoreUrl', () => {
  it('parses App Store URLs', () => {
    expect(parseStoreUrl('https://apps.apple.com/us/app/instagram/id389801252')).toEqual({
      platform: 'ios',
      appId: '389801252',
      country: 'us',
      storeUrl: 'https://apps.apple.com/us/app/instagram/id389801252',
    });
    expect(parseStoreUrl('https://apps.apple.com/app/id389801252').country).toBe('us');
    expect(parseStoreUrl('https://apps.apple.com/cn/app/wechat/id414478124').country).toBe('cn');
  });

  it('parses Google Play URLs', () => {
    expect(parseStoreUrl('https://play.google.com/store/apps/details?id=com.instagram.android')).toEqual({
      platform: 'android',
      appId: 'com.instagram.android',
      country: 'us',
      storeUrl: 'https://play.google.com/store/apps/details?id=com.instagram.android',
    });
  });

  it('rejects unknown URLs', () => {
    expect(() => parseStoreUrl('https://example.com/app')).toThrow(/recognizable/);
    expect(() => parseStoreUrl('https://play.google.com/store/apps/details')).toThrow(/missing/);
  });
});

describe('fetchStoreMetadata', () => {
  it('maps an iTunes lookup response', async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              trackName: 'FoodFast',
              bundleId: 'com.foodfast.app',
              description: 'Order food fast.',
              primaryGenreName: 'Food & Drink',
              artworkUrl512: 'https://example.com/icon.png',
              screenshotUrls: ['https://example.com/s1.png', 'https://example.com/s2.png'],
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;

    const meta = await fetchStoreMetadata(
      { platform: 'ios', appId: '123', country: 'us', storeUrl: 'https://apps.apple.com/us/app/id123' },
      { fetchImpl: fakeFetch },
    );
    expect(meta.name).toBe('FoodFast');
    expect(meta.appId).toBe('com.foodfast.app');
    expect(meta.screenshots).toHaveLength(2);
    expect(meta.category).toBe('Food & Drink');
  });

  it('scrapes a Play listing page best-effort', async () => {
    const html = `<html><head>
      <meta property="og:title" content="FoodFast - Apps on Google Play">
      <meta property="og:image" content="https://play-lh.googleusercontent.com/icon=w240">
      <meta name="description" content="Order food fast.">
      </head><body>
      <img src="https://play-lh.googleusercontent.com/shot1=w526">
      <img src="https://play-lh.googleusercontent.com/shot2=w526">
      </body></html>`;
    const fakeFetch = (async () => new Response(html, { status: 200 })) as typeof fetch;

    const meta = await fetchStoreMetadata(
      {
        platform: 'android',
        appId: 'com.foodfast.app',
        country: 'us',
        storeUrl: 'https://play.google.com/store/apps/details?id=com.foodfast.app',
      },
      { fetchImpl: fakeFetch },
    );
    expect(meta.name).toBe('FoodFast');
    expect(meta.description).toBe('Order food fast.');
    expect(meta.screenshots.length).toBeGreaterThan(0);
  });
});

describe('provisionalIfgFromMetadata', () => {
  it('produces a schema-valid inferred IFG from screenshots', () => {
    const ifg = provisionalIfgFromMetadata({
      platform: 'ios',
      appId: 'com.foodfast.app',
      name: 'FoodFast',
      screenshots: ['https://example.com/s1.png', 'https://example.com/s2.png'],
      storeUrl: 'https://apps.apple.com/us/app/id123',
    });
    expect(ifg.meta.platform).toBe('inferred');
    expect(ifg.nodes).toHaveLength(2);
    expect(ifg.edges).toHaveLength(0);

    const schema = JSON.parse(
      readFileSync(new URL('../../../schemas/ifg.schema.json', import.meta.url), 'utf8'),
    );
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(ifg), JSON.stringify(validate.errors)).toBe(true);
  });
});
