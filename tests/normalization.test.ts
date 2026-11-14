import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCrawlUrl, TRACKING_PARAMS } from '../src/extractor.js';

test('Normalization Suite: Path Casing & Parameter Sanitization', async (t) => {
  await t.test('1. Case-sensitive paths are strictly preserved (RFC 3986)', () => {
    const urls = [
      'https://example.com/Wiki/Case_Sensitive_Article',
      'https://example.com/Users/JohnDoe/Portfolio',
      'https://example.com/API/v1/DesignTokens',
      'https://example.com/deep/NESTED/Path/Index.html'
    ];

    for (const raw of urls) {
      const normalized = normalizeCrawlUrl(raw);
      const expectedPath = new URL(raw).pathname;
      const actualPath = new URL(normalized).pathname;
      assert.equal(actualPath, expectedPath, `Path casing must be preserved for ${raw}`);
    }
  });

  await t.test('2. Case-sensitive query parameter keys and values are preserved', () => {
    const raw = 'https://example.com/search?Category=UserInterface&ViewMode=GRID&Token=AbCdEf123';
    const normalized = normalizeCrawlUrl(raw);
    const u = new URL(normalized);

    assert.equal(u.searchParams.get('Category'), 'UserInterface', 'Query param key and value casing must be preserved');
    assert.equal(u.searchParams.get('ViewMode'), 'GRID', 'ViewMode casing must be preserved');
    assert.equal(u.searchParams.get('Token'), 'AbCdEf123', 'Token value casing must be preserved');
  });

  await t.test('3. Tracking parameters (utm_*, ref, fbclid, etc.) are stripped', () => {
    const raw = 'https://example.com/docs?utm_source=twitter&utm_medium=social&utm_campaign=launch2026&utm_term=design&utm_content=v1&ref=producthunt&source=newsletter&fbclid=IwAR123&gclid=Cjw123&_ga=1.2.3';
    const normalized = normalizeCrawlUrl(raw);
    const u = new URL(normalized);

    assert.equal(u.searchParams.get('utm_source'), null);
    assert.equal(u.searchParams.get('utm_medium'), null);
    assert.equal(u.searchParams.get('utm_campaign'), null);
    assert.equal(u.searchParams.get('utm_term'), null);
    assert.equal(u.searchParams.get('utm_content'), null);
    assert.equal(u.searchParams.get('ref'), null);
    assert.equal(u.searchParams.get('source'), null);
    assert.equal(u.searchParams.get('fbclid'), null);
    assert.equal(u.searchParams.get('gclid'), null);
    assert.equal(u.searchParams.get('_ga'), null);
    assert.equal(u.search, '', 'Query string should be completely empty after stripping all tracking params');
  });

  await t.test('4. Functional parameters are preserved intact while tracking params are removed', () => {
    const raw = 'https://example.com/components?utm_source=slack&page=2&tab=buttons&sort=popular&ref=homepage&lang=en-US';
    const normalized = normalizeCrawlUrl(raw);
    const u = new URL(normalized);

    // Functional parameters MUST be present with exact values
    assert.equal(u.searchParams.get('page'), '2', 'Functional param page must be preserved');
    assert.equal(u.searchParams.get('tab'), 'buttons', 'Functional param tab must be preserved');
    assert.equal(u.searchParams.get('sort'), 'popular', 'Functional param sort must be preserved');
    assert.equal(u.searchParams.get('lang'), 'en-US', 'Functional param lang must be preserved');

    // Tracking params MUST be removed
    assert.equal(u.searchParams.get('utm_source'), null, 'utm_source must be stripped');
    assert.equal(u.searchParams.get('ref'), null, 'ref must be stripped');
  });

  await t.test('5. Hostname and scheme are lowercased per RFC 3986', () => {
    const raw = 'HTTPS://EXAMPLE.COM/Wiki/Page';
    const normalized = normalizeCrawlUrl(raw);
    const u = new URL(normalized);

    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'example.com');
    assert.equal(u.pathname, '/Wiki/Page', 'Path must preserve original casing even when host is lowercased');
  });

  await t.test('6. URL fragments and duplicate slashes are normalized', () => {
    const raw = 'https://example.com//deep///nested//page/?view=list#section-3';
    const normalized = normalizeCrawlUrl(raw);

    assert.equal(normalized, 'https://example.com/deep/nested/page?view=list');
  });
});
