import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FixtureServer {
  server: http.Server;
  baseUrl: string;
  port: number;
  stop: () => Promise<void>;
}

export function startFixtureServer(): Promise<FixtureServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlParts = (req.url || '/').split('?');
      const urlPath = urlParts[0];

      // Exact case-sensitive endpoint check:
      // /Wiki/Case_Sensitive.html returns 200 OK, but /wiki/case_sensitive.html returns 404!
      if (urlPath === '/Wiki/Case_Sensitive.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Case Sensitive Page</title></head>
<body style="background: #101010; color: #f0f0f0;">
  <h1>Case Sensitive Title</h1>
  <button style="background: #e11d48; color: #ffffff; padding: 12px; border-radius: 8px;">Red Button</button>
</body>
</html>`);
        return;
      }

      if (urlPath === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(fs.readFileSync(path.join(__dirname, 'robots.txt'), 'utf-8'));
        return;
      }

      // Safe redirect for robots.txt
      if (urlPath === '/robots-redirect.txt') {
        res.writeHead(302, { 'Location': '/robots.txt' });
        res.end();
        return;
      }

      // 404 handler for robots.txt
      if (urlPath === '/robots-404.txt') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      // 500 error handler for robots.txt
      if (urlPath === '/robots-500.txt') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      // SSRF redirect for robots.txt
      if (urlPath === '/robots-ssrf.txt') {
        res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }

      // Standard sitemap
      if (urlPath === '/sitemap.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        let content = fs.readFileSync(path.join(__dirname, 'sitemap.xml'), 'utf-8');
        content = content.replace(/__BASE_URL__/g, base);
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(content);
        return;
      }

      // Sitemap index pointing to recursive child sitemaps
      if (urlPath === '/sitemap_index.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${base}/sitemap-child-1.xml</loc>
  </sitemap>
  <sitemap>
    <loc>${base}/sitemap-child-2.xml</loc>
  </sitemap>
</sitemapindex>`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(content);
        return;
      }

      // Child sitemap 1
      if (urlPath === '/sitemap-child-1.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/components.html</loc>
  </url>
</urlset>`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(content);
        return;
      }

      // Child sitemap 2 (containing a disallowed link and a deep link)
      if (urlPath === '/sitemap-child-2.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base}/deep.html</loc>
  </url>
  <url>
    <loc>${base}/disallowed/secret.html</loc>
  </url>
</urlset>`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(content);
        return;
      }

      // Sitemap safe redirect
      if (urlPath === '/sitemap-redirect.xml') {
        res.writeHead(302, { 'Location': '/sitemap.xml' });
        res.end();
        return;
      }

      // Cyclic redirect loop
      if (urlPath === '/sitemap-loop-1.xml') {
        res.writeHead(302, { 'Location': '/sitemap-loop-2.xml' });
        res.end();
        return;
      }
      if (urlPath === '/sitemap-loop-2.xml') {
        res.writeHead(302, { 'Location': '/sitemap-loop-1.xml' });
        res.end();
        return;
      }

      // Cyclic sitemap index
      if (urlPath === '/sitemap-cyclic-a.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${base}/sitemap-cyclic-b.xml</loc></sitemap>
</sitemapindex>`);
        return;
      }
      if (urlPath === '/sitemap-cyclic-b.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${base}/sitemap-cyclic-a.xml</loc></sitemap>
  <sitemap><loc>${base}/components.html</loc></sitemap>
</sitemapindex>`);
        return;
      }

      // Sitemap bomb with 25 child sitemaps to verify hard document fetch limit
      if (urlPath === '/sitemap-bomb.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        let indexXml = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        for (let i = 1; i <= 25; i++) {
          indexXml += `  <sitemap><loc>${base}/sitemap-bomb-${i}.xml</loc></sitemap>\n`;
        }
        indexXml += '</sitemapindex>';
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(indexXml);
        return;
      }

      if (urlPath.startsWith('/sitemap-bomb-') && urlPath.endsWith('.xml')) {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
        return;
      }

      // Sitemap SSRF redirect
      if (urlPath === '/sitemap-ssrf-redirect.xml') {
        res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }

      // Sitemap cross-origin redirect
      if (urlPath === '/sitemap-foreign-redirect.xml') {
        res.writeHead(302, { 'Location': 'https://evil-external-domain.com/sitemap.xml' });
        res.end();
        return;
      }

      // Sitemap containing foreign origin URLs
      if (urlPath === '/sitemap-foreign-urls.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://attacker.com/malicious-page</loc>
  </url>
  <url>
    <loc>http://127.0.0.1:9999/different-port</loc>
  </url>
  <url>
    <loc>${base}/components.html</loc>
  </url>
</urlset>`;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(content);
        return;
      }

      // Sitemap exceeding 5MB size limit
      if (urlPath === '/sitemap-oversized.xml') {
        res.writeHead(200, {
          'Content-Type': 'application/xml',
          'Content-Length': `${6 * 1024 * 1024}` // 6 MB
        });
        // Send a 6MB chunk of XML
        const padding = '<!-- oversized sitemap test -->' + 'A'.repeat(1024);
        for (let i = 0; i < 6000; i++) {
          res.write(padding);
        }
        res.end();
        return;
      }

      // Safe internal HTML redirect
      if (urlPath === '/redirect-page') {
        res.writeHead(302, { 'Location': '/components.html' });
        res.end();
        return;
      }

      // Malicious redirect to cloud metadata (SSRF defense test)
      if (urlPath === '/redirect-to-ssrf') {
        res.writeHead(302, { 'Location': 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }

      // 500 error endpoint
      if (urlPath === '/error-500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      if (urlPath === '/components.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(__dirname, 'components.html'), 'utf-8'));
        return;
      }

      if (urlPath === '/deep.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(__dirname, 'deep.html'), 'utf-8'));
        return;
      }

      if (urlPath === '/disallowed/secret.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Disallowed Secret Content</body></html>');
        return;
      }

      // Main index
      if (urlPath === '/' || urlPath === '/index.html') {
        let content = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
        // Add a link to /Wiki/Case_Sensitive.html to verify case sensitivity during graph crawling
        if (!content.includes('/Wiki/Case_Sensitive.html')) {
          content = content.replace('</body>', '<a href="/Wiki/Case_Sensitive.html">Wiki Page</a></body>');
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      const port = addr.port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        baseUrl,
        port,
        stop: () => new Promise<void>((res) => server.close(() => res()))
      });
    });

    server.on('error', reject);
  });
}
