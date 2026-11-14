import test from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureServer, FixtureServer } from './fixtures/server.js';
import { validateAndResolveUrl, isPrivateIPv4, isPrivateIPv6, isBlockedHostname } from '../src/security.js';
import { extractDesignTokens } from '../src/extractor.js';

let server: FixtureServer;

test.before(async () => {
  server = await startFixtureServer();
});

test.after(async () => {
  if (server) await server.stop();
});

test('Security Suite: SSRF, Redirects, DNS Rebinding & Resource Bounds', async (t) => {
  await t.test('1. SSRF: Loopback and local address rejection', async () => {
    // Normal operation without test bypass
    const localhostRes = await validateAndResolveUrl('http://localhost:3000');
    assert.equal(localhostRes.safe, false, 'localhost should be rejected');

    const loopbackRes = await validateAndResolveUrl('http://127.0.0.1:8080');
    assert.equal(loopbackRes.safe, false, '127.0.0.1 should be rejected');

    const zeroRes = await validateAndResolveUrl('http://0.0.0.0:8000');
    assert.equal(zeroRes.safe, false, '0.0.0.0 should be rejected');
  });

  await t.test('2. SSRF: RFC 1918 private network ranges rejection', async () => {
    const classA = await validateAndResolveUrl('http://10.0.0.1/admin');
    assert.equal(classA.safe, false, '10.0.0.0/8 should be rejected');

    const classB = await validateAndResolveUrl('http://172.16.5.10/');
    assert.equal(classB.safe, false, '172.16.0.0/12 should be rejected');

    const classC = await validateAndResolveUrl('http://192.168.1.1/setup');
    assert.equal(classC.safe, false, '192.168.0.0/16 should be rejected');

    const cgnat = await validateAndResolveUrl('http://100.64.1.1/');
    assert.equal(cgnat.safe, false, '100.64.0.0/10 CGNAT should be rejected');
  });

  await t.test('3. SSRF: Cloud metadata service endpoints rejection', async () => {
    const awsMetadata = await validateAndResolveUrl('http://169.254.169.254/latest/meta-data/');
    assert.equal(awsMetadata.safe, false, '169.254.169.254 link-local should be rejected');

    const gcpMetadata = await validateAndResolveUrl('http://metadata.google.internal/computeMetadata/v1/');
    assert.equal(gcpMetadata.safe, false, 'GCP metadata hostname should be rejected');

    const awsAlias = await validateAndResolveUrl('http://instance-data/');
    assert.equal(awsAlias.safe, false, 'instance-data hostname alias should be rejected');
  });

  await t.test('4. SSRF: IPv6 private, loopback, and IPv4-mapped addresses rejection', async () => {
    assert.equal(isPrivateIPv6('::1'), true, 'IPv6 loopback ::1 should be private');
    assert.equal(isPrivateIPv6('::'), true, 'IPv6 unspecified :: should be private');
    assert.equal(isPrivateIPv6('::ffff:127.0.0.1'), true, 'IPv4-mapped 127.0.0.1 should be private');
    assert.equal(isPrivateIPv6('::ffff:169.254.169.254'), true, 'IPv4-mapped metadata IP should be private');
    assert.equal(isPrivateIPv6('fe80::1'), true, 'IPv6 link-local fe80:: should be private');
    assert.equal(isPrivateIPv6('fc00::1'), true, 'IPv6 unique local fc00:: should be private');
  });

  await t.test('5. Protocol validation: rejects non-http/https schemes', async () => {
    const fileRes = await validateAndResolveUrl('file:///etc/passwd');
    assert.equal(fileRes.safe, false);
    assert.match(fileRes.reason || '', /disallowed protocol 'file:'/i);

    const ftpRes = await validateAndResolveUrl('ftp://ftp.example.com/data');
    assert.equal(ftpRes.safe, false);
    assert.match(ftpRes.reason || '', /disallowed protocol 'ftp:'/i);

    const jsRes = await validateAndResolveUrl('javascript:alert(1)');
    assert.equal(jsRes.safe, false);
  });

  await t.test('6. Non-web sensitive ports rejection', async () => {
    const sshRes = await validateAndResolveUrl('http://example.com:22');
    assert.equal(sshRes.safe, false);
    assert.match(sshRes.reason || '', /port 22 is blocked/i);

    const redisRes = await validateAndResolveUrl('http://example.com:6379');
    assert.equal(redisRes.safe, false);
    assert.match(redisRes.reason || '', /port 6379 is blocked/i);

    const smtpRes = await validateAndResolveUrl('http://example.com:25');
    assert.equal(smtpRes.safe, false);
    assert.match(smtpRes.reason || '', /port 25 is blocked/i);
  });

  await t.test('7. Embedded credentials rejection in URLs', async () => {
    const credRes = await validateAndResolveUrl('http://admin:secret@example.com');
    assert.equal(credRes.safe, false);
    assert.match(credRes.reason || '', /embedded user credentials/i);
  });

  await t.test('8. Malicious redirect destination validation', async () => {
    // Enable local test server access for fixture URL
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
    try {
      // Visiting /redirect-to-ssrf triggers an HTTP 302 to http://169.254.169.254/latest/meta-data/
      // The Playwright route interception MUST catch and abort this destination
      await assert.rejects(
        async () => {
          await extractDesignTokens(`${server.baseUrl}/redirect-to-ssrf`, 1);
        },
        /Failed to extract data|SSRF/i,
        'Redirect to internal/metadata destination must be aborted'
      );
    } finally {
      delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    }
  });

  await t.test('9. Resource bounds: Depth clamped to maximum 3', async () => {
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';
    try {
      // Pass an oversized depth limit of 99
      const tokens = await extractDesignTokens(server.baseUrl, 99);
      // Ensure no crawled page has depth >= 3
      const deepPages = tokens.crawledDetails?.filter(d => d.depth >= 3);
      assert.equal(deepPages?.length, 0, 'Crawl depth must be strictly clamped to <= 3');
    } finally {
      delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    }
  });

  await t.test('10. Security test bypass cannot be activated in production (NODE_ENV=production)', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';

    try {
      // In production, even if STYLEPROBE_TEST_ALLOW_LOCAL is set, loopback MUST be blocked
      const localRes = await validateAndResolveUrl('http://127.0.0.1');
      assert.equal(localRes.safe, false, '127.0.0.1 must be rejected in production');

      const localhostRes = await validateAndResolveUrl('http://localhost');
      assert.equal(localhostRes.safe, false, 'localhost must be rejected in production');

      const metaRes = await validateAndResolveUrl('http://169.254.169.254/latest/meta-data');
      assert.equal(metaRes.safe, false, 'Cloud metadata must always be rejected');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    }
  });

  await t.test('11. Security test bypass never permits cloud metadata or non-loopback private ranges', async () => {
    // When test bypass is enabled in test environment, only 127.0.0.1 is permitted for the test fixture server
    process.env.STYLEPROBE_TEST_ALLOW_LOCAL = '1';

    try {
      // Cloud metadata MUST remain blocked
      const metaRes = await validateAndResolveUrl('http://169.254.169.254');
      assert.equal(metaRes.safe, false, '169.254.169.254 must remain blocked even with bypass flag');

      // Private RFC 1918 subnets MUST remain blocked
      const p10Res = await validateAndResolveUrl('http://10.0.0.1');
      assert.equal(p10Res.safe, false, '10.0.0.1 must remain blocked');

      const p192Res = await validateAndResolveUrl('http://192.168.1.1');
      assert.equal(p192Res.safe, false, '192.168.1.1 must remain blocked');

      const p172Res = await validateAndResolveUrl('http://172.16.0.1');
      assert.equal(p172Res.safe, false, '172.16.0.1 must remain blocked');
    } finally {
      delete process.env.STYLEPROBE_TEST_ALLOW_LOCAL;
    }
  });
});
