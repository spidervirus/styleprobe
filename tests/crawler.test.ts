import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';
import { extractDesignTokens } from '../src/extractor.js';

let server: FixtureServer;

test.before(async () => {
  process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
  server = await startFixtureServer();
});

test.after(async () => {
  delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
  if (server) await server.stop();
});

test('Crawler Suite: Graph Traversal, Depth, Normalization & Filtering', async (t) => {
  await t.test('1. Depth 1 bounds crawl strictly to root page', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 1);

    assert.equal(tokens.crawledPages?.length, 1, 'Depth 1 should visit only 1 page (the root)');
    assert.equal(tokens.crawledDetails?.length, 1);
    assert.equal(tokens.crawledDetails?.[0].depth, 0, 'Root page must be recorded at depth 0');
  });

  await t.test('2. Depth 2 crawls root and child pages with exact depth tracking', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 2);

    assert.ok((tokens.crawledPages?.length || 0) >= 2, 'Depth 2 should visit root and child pages');
    
    // Verify exact depth tracking
    const rootItem = tokens.crawledDetails?.find(d => d.depth === 0);
    assert.ok(rootItem, 'Must have a depth 0 root page');

    const depth1Items = tokens.crawledDetails?.filter(d => d.depth === 1);
    assert.ok(depth1Items && depth1Items.length >= 1, 'Must have at least one depth 1 child page');

    // Confirm that no depth 2 page was crawled when depth limit is 2
    const depth2Items = tokens.crawledDetails?.filter(d => d.depth >= 2);
    assert.equal(depth2Items?.length, 0, 'Depth 2 limit must not crawl depth >= 2 grandchildren');
  });

  await t.test('3. Strict BFS ordering: monotonic depth sequence (all depth d precede depth d+1)', async () => {
    // Crawl up to depth 3 to test full 3-tier BFS traversal
    const tokens = await extractDesignTokens(server.baseUrl, 3);
    const details = tokens.crawledDetails || [];

    assert.ok(details.length >= 2, 'Should crawl multiple pages at depth 3');
    assert.equal(details[0].depth, 0, 'First crawled page must be root depth 0');

    // Mathematical monotonicity verification: depth must be non-decreasing throughout the crawl
    for (let i = 0; i < details.length - 1; i++) {
      assert.ok(
        details[i].depth <= details[i + 1].depth,
        `Strict BFS violation: page at index ${i} (depth ${details[i].depth}) must precede or match page at index ${i + 1} (depth ${details[i + 1].depth})`
      );
    }
  });

  await t.test('4. Multi-page aggregation: tokens merged from subpages', async () => {
    const singlePageTokens = await extractDesignTokens(server.baseUrl, 1);
    const multiPageTokens = await extractDesignTokens(server.baseUrl, 2);

    // Multi-page crawl discovers additional components declared on /components.html
    assert.ok(
      multiPageTokens.components.length >= singlePageTokens.components.length,
      'Multi-page crawl should discover at least as many or more components'
    );
  });

  await t.test('5. Non-HTML asset exclusion (.pdf, .zip, etc.)', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 2);
    const visitedUrls = tokens.crawledPages || [];

    const hasPdf = visitedUrls.some(u => u.endsWith('.pdf') || u.includes('manual.pdf'));
    assert.equal(hasPdf, false, 'Crawler must NOT crawl .pdf or binary asset links');
  });

  await t.test('6. Auth and policy route exclusion (/login, /privacy, etc.)', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 2);
    const visitedUrls = tokens.crawledPages || [];

    const hasLogin = visitedUrls.some(u => u.includes('/login'));
    assert.equal(hasLogin, false, 'Crawler must NOT crawl /login or auth routes');
  });

  await t.test('7. Robots.txt compliance: skips disallowed paths', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, 2);
    const visitedUrls = tokens.crawledPages || [];

    const hasDisallowed = visitedUrls.some(u => u.includes('/disallowed/secret.html'));
    assert.equal(hasDisallowed, false, 'Crawler must respect robots.txt and skip disallowed paths');
  });

  await t.test('8. Sitemap discovery seeds BFS queue within bounds', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, {
      depth: 2,
      sitemap: true
    });

    assert.ok((tokens.crawledPages?.length || 0) >= 2, 'Sitemap discovery should crawl pages');
    const hasComponents = tokens.crawledPages?.some(u => u.includes('components.html'));
    assert.ok(hasComponents, 'Sitemap-seeded queue should crawl components.html');
  });

  await t.test('9. Sitemap-seeded pages are consistently assigned and reported at depth 1', async () => {
    const tokens = await extractDesignTokens(server.baseUrl, {
      depth: 2,
      sitemap: true
    });

    const details = tokens.crawledDetails || [];
    assert.ok(details.length >= 2, 'Should have multiple crawled details');

    // Root is depth 0
    assert.equal(details[0].depth, 0, 'Homepage root must be depth 0');

    // Any page seeded from sitemap (e.g. /components.html) must strictly be reported at depth 1
    const sitemapDiscovered = details.find(d => d.url.includes('components.html'));
    assert.ok(sitemapDiscovered, 'components.html should be crawled');
    assert.equal(
      sitemapDiscovered.depth,
      1,
      'Sitemap-seeded pages must consistently be reported at depth 1'
    );
  });

  await t.test('10. Case-sensitive path preservation during graph crawling', async () => {
    // /Wiki/Case_Sensitive.html exists with exact casing; /wiki/case_sensitive.html would 404
    const tokens = await extractDesignTokens(server.baseUrl, 2);
    const visitedUrls = tokens.crawledPages || [];

    const hasCaseSensitive = visitedUrls.some(u => u.includes('/Wiki/Case_Sensitive.html'));
    assert.ok(hasCaseSensitive, 'Crawler must preserve exact path casing and crawl /Wiki/Case_Sensitive.html');

    // Verify token extraction from the case-sensitive subpage
    const hasRedButton = tokens.components.some(
      c => c.type === 'button' && (c.styles.backgroundColor.includes('225, 29, 72') || c.sampleHtml?.includes('Red Button'))
    );
    assert.ok(hasRedButton, 'Component tokens from case-sensitive page must be extracted');
  });
});
