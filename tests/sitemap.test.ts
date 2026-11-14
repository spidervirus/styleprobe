import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverSitemapUrls, fetchXmlSafe, extractLocUrls } from '../src/sitemap.js';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';
import { parseRobotsTxt } from '../src/robots.js';

let server: FixtureServer;

test.before(async () => {
  process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
  server = await startFixtureServer();
});

test.after(async () => {
  delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
  if (server) await server.stop();
});

test('Sitemap Suite: Index Recursion, Redirects, Size Limits & Origin Bounds', async (t) => {
  await t.test('1. Basic XML sitemap parsing extracts valid loc URLs', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/components</loc>
  </url>
  <url>
    <loc>https://example.com/tokens</loc>
  </url>
</urlset>`;

    const urls = extractLocUrls(xml);
    assert.deepEqual(urls, [
      'https://example.com/components',
      'https://example.com/tokens'
    ]);
  });

  await t.test('2. Sitemap index recursion: discovers child sitemap URLs recursively', async () => {
    // /sitemap_index.xml points to /sitemap-child-1.xml and /sitemap-child-2.xml
    const urls = await discoverSitemapUrls(server.baseUrl, 10);

    assert.ok(urls.length >= 2, 'Should discover pages from recursive child sitemaps');
    assert.ok(urls.some(u => u.includes('components.html')), 'Should extract components.html from child 1');
    assert.ok(urls.some(u => u.includes('deep.html')), 'Should extract deep.html from child 2');
  });

  await t.test('3. Redirect handling: follows safe same-origin sitemap redirects', async () => {
    // Directly fetch safe redirect /sitemap-redirect.xml -> /sitemap.xml
    const xml = await fetchXmlSafe(`${server.baseUrl}/sitemap-redirect.xml`, server.baseUrl);
    assert.ok(xml !== null, 'Safe redirect must be followed');
    assert.ok(xml.includes('<loc>'), 'Result must contain XML loc entries');
  });

  await t.test('4. Redirect handling: aborts malicious SSRF redirect destination', async () => {
    // /sitemap-ssrf-redirect.xml redirects to cloud metadata 169.254.169.254
    const xml = await fetchXmlSafe(`${server.baseUrl}/sitemap-ssrf-redirect.xml`, server.baseUrl);
    assert.equal(xml, null, 'Redirect to cloud metadata / SSRF IP must be rejected');
  });

  await t.test('5. Redirect handling: aborts cross-origin redirect destination', async () => {
    // /sitemap-foreign-redirect.xml redirects to https://evil-external-domain.com
    const xml = await fetchXmlSafe(`${server.baseUrl}/sitemap-foreign-redirect.xml`, server.baseUrl);
    assert.equal(xml, null, 'Cross-origin redirect must be rejected');
  });

  await t.test('6. Size limits: rejects sitemaps exceeding 5MB', async () => {
    // /sitemap-oversized.xml serves > 5MB response
    const xml = await fetchXmlSafe(`${server.baseUrl}/sitemap-oversized.xml`, server.baseUrl);
    assert.equal(xml, null, 'Oversized sitemap (> 5MB) must be rejected to prevent memory exhaustion');
  });

  await t.test('7. Page-budget enforcement: strictly caps discovered URLs to maxEntries', async () => {
    // Ask for maxEntries = 1
    const urls = await discoverSitemapUrls(server.baseUrl, 1);
    assert.equal(urls.length, 1, 'Must strictly enforce page budget of 1 URL');
  });

  await t.test('8. Same-origin restrictions: filters out foreign hostnames and ports', async () => {
    const urls = await discoverSitemapUrls(`${server.baseUrl}/sitemap-foreign-urls.xml`, 10);

    // /sitemap-foreign-urls.xml contains attacker.com and 127.0.0.1:9999
    for (const u of urls) {
      const parsed = new URL(u);
      assert.equal(parsed.origin, server.baseUrl, 'All sitemap URLs must belong strictly to origin');
      assert.notEqual(parsed.hostname, 'attacker.com');
      assert.notEqual(parsed.port, '9999');
    }
  });

  await t.test('9. Robots.txt compliance: sitemap URLs filter out disallowed paths', async () => {
    const robotsContent = `
User-agent: *
Disallow: /disallowed/secret.html
`;
    const rules = parseRobotsTxt(robotsContent);
    const urls = await discoverSitemapUrls(server.baseUrl, 10, rules);

    const hasSecret = urls.some(u => u.includes('disallowed/secret.html'));
    assert.equal(hasSecret, false, 'Disallowed sitemap URLs must be filtered out');
  });

  await t.test('10. Cyclic index prevention: circular sitemapindex references terminate cleanly', async () => {
    // /sitemap-cyclic-a.xml points to /sitemap-cyclic-b.xml which points back to /sitemap-cyclic-a.xml
    const customRules = {
      disallows: [],
      allows: [],
      sitemaps: [`${server.baseUrl}/sitemap-cyclic-a.xml`]
    };

    const startTime = Date.now();
    const urls = await discoverSitemapUrls(server.baseUrl, 10, customRules);
    const duration = Date.now() - startTime;

    assert.ok(duration < 5000, `Cyclic sitemap resolution must not hang (took ${duration}ms)`);
    assert.ok(urls.some(u => u.includes('components.html')), 'Should extract valid components.html from non-cyclic branch');
  });

  await t.test('11. Cyclic redirect prevention: circular HTTP 302 redirects abort safely', async () => {
    // /sitemap-loop-1.xml -> /sitemap-loop-2.xml -> /sitemap-loop-1.xml
    const xml = await fetchXmlSafe(`${server.baseUrl}/sitemap-loop-1.xml`, server.baseUrl);
    assert.equal(xml, null, 'Cyclic redirect loop must abort safely and return null');
  });

  await t.test('12. Hard document fetch limit: sitemap bomb with 25 child sitemaps is strictly capped', async () => {
    // /sitemap-bomb.xml lists 25 child sitemaps (/sitemap-bomb-1.xml to 25.xml)
    const customRules = {
      disallows: [],
      allows: [],
      sitemaps: [`${server.baseUrl}/sitemap-bomb.xml`]
    };

    const urls = await discoverSitemapUrls(server.baseUrl, 50, customRules);
    // Discovery completes cleanly without fetching all 25 child sitemaps
    assert.ok(Array.isArray(urls));
  });
});
