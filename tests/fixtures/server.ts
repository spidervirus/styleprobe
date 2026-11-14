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
      const urlPath = req.url?.split('?')[0] || '/';

      if (urlPath === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(fs.readFileSync(path.join(__dirname, 'robots.txt'), 'utf-8'));
        return;
      }

      if (urlPath === '/sitemap.xml') {
        const addr = server.address() as any;
        const base = `http://127.0.0.1:${addr.port}`;
        let content = fs.readFileSync(path.join(__dirname, 'sitemap.xml'), 'utf-8');
        content = content.replace(/__BASE_URL__/g, base);
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(content);
        return;
      }

      // Safe internal redirect
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
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8'));
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
