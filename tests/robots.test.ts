import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotsTxt, isAllowedByRobots, fetchRobotsTxt, RobotsRules } from '../src/robots.js';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';

let server: FixtureServer;

test.before(async () => {
  process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
  server = await startFixtureServer();
});

test.after(async () => {
  delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
  if (server) await server.stop();
});

test('Robots Suite: RFC 9309 Precedence, Directive Parsing & Failure Handling', async (t) => {
  await t.test('1. Longest prefix match: Allow overrides shorter Disallow', () => {
    const rules: RobotsRules = {
      disallows: ['/admin'],
      allows: ['/admin/public'],
      sitemaps: []
    };

    // /admin/public/page is 13 chars matching Allow, vs 6 chars matching Disallow -> Allow wins
    assert.equal(isAllowedByRobots('/admin/public/page', rules), true);
    // /admin/private/page matches only Disallow -> Disallow wins
    assert.equal(isAllowedByRobots('/admin/private/page', rules), false);
  });

  await t.test('2. Longest prefix match: Disallow overrides shorter Allow', () => {
    const rules: RobotsRules = {
      disallows: ['/public/secret'],
      allows: ['/public'],
      sitemaps: []
    };

    // /public/secret/keys matches 14 chars Disallow vs 7 chars Allow -> Disallow wins
    assert.equal(isAllowedByRobots('/public/secret/keys', rules), false);
    // /public/docs matches only Allow -> Allow wins
    assert.equal(isAllowedByRobots('/public/docs', rules), true);
  });

  await t.test('3. Equal length tie: Allow takes precedence per RFC 9309', () => {
    const rules: RobotsRules = {
      disallows: ['/components'],
      allows: ['/components'],
      sitemaps: []
    };

    // Equal length of 11 chars: RFC 9309 specifies Allow wins
    assert.equal(isAllowedByRobots('/components', rules), true);
  });

  await t.test('4. Empty rules allow all paths (fail-open)', () => {
    const emptyRules: RobotsRules = { disallows: [], allows: [], sitemaps: [] };
    assert.equal(isAllowedByRobots('/anything/under/the/sun', emptyRules), true);
  });

  await t.test('5. Parser handles User-agent specificity and extracts Sitemap directives', () => {
    const content = `
# Robots.txt file
User-agent: Googlebot
Disallow: /google-only

User-agent: styleprobe
Disallow: /disallowed/secret
Allow: /disallowed/secret/public
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap_index.xml

User-agent: *
Disallow: /temp
`;
    const rules = parseRobotsTxt(content);

    assert.ok(rules.disallows.includes('/disallowed/secret'));
    assert.ok(rules.allows.includes('/disallowed/secret/public'));
    assert.equal(rules.sitemaps.length, 2);
    assert.equal(rules.sitemaps[0], 'https://example.com/sitemap.xml');
    assert.equal(rules.sitemaps[1], 'https://example.com/sitemap_index.xml');
  });

  await t.test('6. Failure handling: 404 response fails open gracefully', async () => {
    // Probing an endpoint where robots.txt returns 404 Not Found
    const rules = await fetchRobotsTxt(`${server.baseUrl}/robots-404.txt`);
    assert.equal(rules.disallows.length, 0);
    assert.equal(rules.allows.length, 0);
    // Should permit crawling
    assert.equal(isAllowedByRobots('/components.html', rules), true);
  });

  await t.test('7. Failure handling: 500 Internal Server Error fails open gracefully', async () => {
    // Even if server returns 500 error, crawler does not crash and falls back to permissive
    const rules = await fetchRobotsTxt(`${server.baseUrl}/robots-500.txt`);
    assert.equal(rules.disallows.length, 0);
    assert.equal(rules.allows.length, 0);
  });

  await t.test('8. Failure handling: SSRF target blocked before network fetch', async () => {
    delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    const rules = await fetchRobotsTxt('http://169.254.169.254');
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';

    assert.equal(rules.disallows.length, 0);
    assert.equal(rules.allows.length, 0);
  });

  await t.test('9. Redirect handling: follows safe same-origin redirect', async () => {
    // /robots-redirect.txt redirects 302 to /robots.txt
    const rules = await fetchRobotsTxt(`${server.baseUrl}/robots-redirect.txt`);
    assert.ok(rules.disallows.includes('/disallowed/'));
  });

  await t.test('10. Redirect handling: aborts malicious SSRF redirect', async () => {
    // /robots-ssrf.txt redirects to 169.254.169.254
    const rules = await fetchRobotsTxt(`${server.baseUrl}/robots-ssrf.txt`);
    assert.equal(rules.disallows.length, 0, 'Must abort SSRF redirect destination');
  });

  await t.test('11. RFC 9309: standard wildcard (*) pattern matching', () => {
    const rules: RobotsRules = {
      disallows: ['/admin/*/secret', '/catalog*'],
      allows: ['/catalog/public'],
      sitemaps: []
    };

    assert.equal(isAllowedByRobots('/admin/users/secret', rules), false, 'Should match wildcard in /admin/*/secret');
    assert.equal(isAllowedByRobots('/admin/123/secret/keys', rules), false, 'Should match wildcard in /admin/*/secret with subpaths');
    assert.equal(isAllowedByRobots('/admin/users/public', rules), true, 'Non-matching wildcard path should be allowed');
    assert.equal(isAllowedByRobots('/catalog-items', rules), false, 'Should match /catalog*');
    assert.equal(isAllowedByRobots('/catalog/public', rules), true, 'Exact longer allow should override /catalog*');
  });

  await t.test('12. RFC 9309: end-anchor ($) pattern matching', () => {
    const rules: RobotsRules = {
      disallows: ['/*.json$', '/exact$'],
      allows: [],
      sitemaps: []
    };

    assert.equal(isAllowedByRobots('/data.json', rules), false, 'Should block exact .json ending');
    assert.equal(isAllowedByRobots('/nested/deep/config.json', rules), false, 'Should block .json ending anywhere');
    assert.equal(isAllowedByRobots('/data.json/subpath', rules), true, 'Should NOT block if path continues beyond $ anchor');
    assert.equal(isAllowedByRobots('/data.json?v=1', rules), true, 'Should NOT block if query parameters follow path without query in pattern');
    assert.equal(isAllowedByRobots('/exact', rules), false, 'Should block exact match');
    assert.equal(isAllowedByRobots('/exact/more', rules), true, 'Should NOT block subpath for $ anchored pattern');
  });

  await t.test('13. RFC 9309: longest-match precedence with mixed wildcards and anchors', () => {
    const rules: RobotsRules = {
      disallows: ['/*', '/public/secret/*'],
      allows: ['/public/*', '/public/secret/preview.html$'],
      sitemaps: []
    };

    // /public/secret/preview.html:
    // Matches '/public/secret/preview.html$' (len 28, Allow) -> LONGEST!
    assert.equal(isAllowedByRobots('/public/secret/preview.html', rules), true);

    // /public/secret/other.html:
    // Matches '/public/secret/*' (len 17, Disallow) -> LONGEST!
    assert.equal(isAllowedByRobots('/public/secret/other.html', rules), false);

    // /public/blog/post-1:
    // Matches '/public/*' (len 10, Allow) -> LONGEST!
    assert.equal(isAllowedByRobots('/public/blog/post-1', rules), true);

    // /private/dashboard:
    // Matches '/*' (len 2, Disallow) -> LONGEST!
    assert.equal(isAllowedByRobots('/private/dashboard', rules), false);
  });

  await t.test('14. RFC 9309: equal length tie-breaking with wildcards (Allow wins)', () => {
    const rules: RobotsRules = {
      disallows: ['/items/*.html'],
      allows: ['/items/*.html'],
      sitemaps: []
    };

    // Both rules have length 13. RFC 9309 requires Allow to win
    assert.equal(isAllowedByRobots('/items/test.html', rules), true);
  });
});
