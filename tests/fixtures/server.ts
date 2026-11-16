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

      if (urlPath === '/modern-colors.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Modern CSS Colors Fixture</title>
  <style>
    :root {
      --primary: oklch(0.6 0.2 240);
      --background: #ffffff;
      --surface: lab(95% -10 10);
      --foreground: oklab(0.2 0 0);
      --border: color(display-p3 0.8 0.8 0.8);
      --brand-p3: color(display-p3 1 0 0);
    }
    .dark, [data-theme="dark"] {
      --primary: oklch(0.7 0.15 150);
      --background: oklab(0.15 0 0);
      --surface: oklab(0.25 0 0);
      --foreground: #f8fafc;
      --border: oklab(0.35 0 0);
    }
    body {
      background-color: var(--background);
      color: var(--foreground);
    }
    .card {
      background-color: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }
    .btn-p3 {
      background-color: var(--brand-p3);
      color: #ffffff;
      border-radius: 8px;
      padding: 10px 20px;
    }
    .hero button {
      background-color: var(--primary);
      color: #ffffff;
      border-radius: 8px;
      padding: 12px 24px;
    }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Modern CSS Color Tokens</h1>
    <button>Explore Tokens</button>
  </div>
  <div class="card">
    <p>Surface styled with CIE LAB</p>
    <button class="btn-p3">Display-P3 Action</button>
  </div>
</body>
</html>`);
        return;
      }

      if (urlPath === '/cta-benchmark.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CTA Semantic Scoring Fixture</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #09090b;
      --nav-bg: #f4f4f5;
      --utility-btn: #e4e4e7;
      --hero-primary: #6366f1;
    }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: sans-serif; }
    header.navbar {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 24px;
      background: var(--nav-bg);
      border-bottom: 1px solid #e4e4e7;
    }
    .navbar .theme-toggle { background: var(--utility-btn); width: 32px; height: 32px; border: none; border-radius: 6px; }
    .navbar .search-btn { background: var(--utility-btn); padding: 6px 12px; border: 1px solid #d4d4d8; border-radius: 6px; font-size: 13px; }
    .navbar .lang-btn { background: var(--utility-btn); padding: 6px 10px; border: none; border-radius: 6px; font-size: 13px; }
    .navbar .menu-btn { background: var(--utility-btn); width: 32px; height: 32px; border: none; border-radius: 6px; }

    section.hero {
      padding: 80px 24px;
      max-width: 800px;
      margin: 0 auto;
      text-align: center;
    }
    .hero h1 { font-size: 48px; margin-bottom: 16px; }
    .hero p { font-size: 18px; color: #52525b; margin-bottom: 32px; }
    .hero .cta-primary {
      display: inline-block;
      background-color: var(--hero-primary);
      color: #ffffff;
      font-size: 18px;
      font-weight: 600;
      padding: 16px 36px;
      border-radius: 12px;
      text-decoration: none;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }
  </style>
</head>
<body>
  <header class="navbar">
    <div class="logo">BrandLogo</div>
    <button class="search-btn" aria-label="Search documentation">Search docs...</button>
    <button class="lang-btn" title="Select Language">English</button>
    <button class="theme-toggle" aria-label="Toggle dark mode" title="Appearance">🌙</button>
    <button class="menu-btn" aria-label="Open menu">☰</button>
  </header>
  <section class="hero">
    <h1>Supercharge Your Workflow</h1>
    <p>The next-generation framework for modern web development.</p>
    <a href="/get-started" class="cta-primary">Get Started Free</a>
  </section>
</body>
</html>`);
        return;
      }

      if (urlPath === '/competing-cta.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Competing CTA Fixture</title>
  <style>
    body { margin: 0; background: #ffffff; color: #09090b; font-family: sans-serif; }
    .hero { padding: 60px 20px; text-align: center; }
    .actions { display: flex; gap: 16px; justify-content: center; margin-top: 24px; }
    .btn-primary {
      background-color: #2563eb;
      color: #ffffff;
      padding: 14px 28px;
      border-radius: 8px;
      font-weight: 600;
      border: none;
      cursor: pointer;
    }
    .btn-secondary {
      background-color: #f1f5f9;
      color: #0f172a;
      padding: 14px 28px;
      border-radius: 8px;
      font-weight: 500;
      border: 1px solid #cbd5e1;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Enterprise Cloud Platform</h1>
    <div class="actions">
      <button class="btn-primary">Start Free Trial</button>
      <a href="/docs" class="btn-secondary">View Documentation</a>
    </div>
  </div>
</body>
</html>`);
        return;
      }

      if (urlPath === '/non-button-regression.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Non-Button Tag Qualification Regression Fixture</title>
  <style>
    body { background-color: #f8f9fa; color: #101418; font-family: sans-serif; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 20px; }
    .cdx-button__icon { display: inline-block; background-color: transparent; color: #404244; }
    .vector-dropdown-label { background-color: transparent; color: #404244; }
    .action-btn {
      background-color: #eaecf0;
      color: #202122;
      border: 1px solid #c8ccd1;
      padding: 8px 16px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <label class="vector-dropdown-label cdx-button">Menu Option</label>
    <span class="vector-icon cdx-button__icon">Icon Symbol</span>
    <input type="checkbox" role="button" class="vector-button-checkbox">
  </div>
  <main>
    <h1>Knowledge Repository</h1>
    <button class="action-btn">Pin to Sidebar</button>
  </main>
</body>
</html>`);
        return;
      }

      // Edge case 1: Solid navbar utility buttons competing with an outline hero CTA
      if (urlPath === '/cta-solid-nav-outline-hero.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Solid Navbar vs Outline Hero CTA</title>
  <style>
    body { background-color: #0f172a; color: #f8fafc; font-family: sans-serif; margin: 0; }
    header { display: flex; justify-content: flex-end; gap: 12px; padding: 16px; background-color: #1e293b; }
    .nav-btn { background-color: #334155; color: #f8fafc; padding: 6px 12px; border-radius: 4px; border: none; font-size: 13px; }
    .hero { padding: 60px 24px; text-align: center; }
    .hero h1 { font-size: 40px; margin-bottom: 24px; }
    .outline-cta {
      background-color: transparent;
      border: 2px solid #6366f1;
      color: #6366f1;
      padding: 14px 28px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <header>
    <button class="nav-btn theme-toggle">Toggle Theme</button>
    <button class="nav-btn search-btn">Quick Search</button>
  </header>
  <main class="hero">
    <h1>Next-Generation Cloud Platform</h1>
    <button class="outline-cta">Get Started Free</button>
  </main>
</body>
</html>`);
        return;
      }

      // Edge case 2: Multiple solid buttons with different semantic importance
      if (urlPath === '/cta-multiple-solid.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Multiple Solid Buttons with Different Semantic Importance</title>
  <style>
    body { background-color: #ffffff; color: #0f172a; font-family: sans-serif; margin: 0; }
    .hero { padding: 40px 20px; }
    .actions { display: flex; gap: 16px; margin-top: 24px; }
    .btn-primary { background-color: #10b981; color: #ffffff; padding: 16px 32px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
    .btn-secondary { background-color: #64748b; color: #ffffff; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; }
    .btn-dismiss { background-color: #ef4444; color: #ffffff; padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Accelerate Development</h1>
    <div class="actions">
      <button class="btn-primary">Start Free Trial</button>
      <button class="btn-secondary">View Documentation</button>
      <button class="btn-dismiss">Dismiss</button>
    </div>
  </div>
</body>
</html>`);
        return;
      }

      // Edge case 3: An outline-only page
      if (urlPath === '/cta-outline-only.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Outline-Only Page</title>
  <style>
    body { background-color: #ffffff; color: #18181b; font-family: sans-serif; margin: 0; }
    .hero { padding: 50px 20px; text-align: center; }
    .hero-btn {
      background-color: transparent;
      border: 2px solid #ec4899;
      color: #ec4899;
      padding: 14px 28px;
      font-size: 16px;
      border-radius: 6px;
      cursor: pointer;
    }
    .sub-btn {
      background-color: transparent;
      border: 1px solid #71717a;
      color: #71717a;
      padding: 10px 20px;
      font-size: 14px;
      border-radius: 6px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Open Source Collective</h1>
    <button class="hero-btn">Join Community</button>
    <button class="sub-btn">Learn More</button>
  </div>
</body>
</html>`);
        return;
      }

      // Edge case 4: A hero CTA implemented as an accessible div with role="button"
      if (urlPath === '/cta-accessible-div.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Accessible Div Role Button Hero CTA</title>
  <style>
    body { background-color: #ffffff; color: #09090b; font-family: sans-serif; margin: 0; }
    .hero { padding: 40px; }
    .div-cta {
      display: inline-block;
      background-color: #8b5cf6;
      color: #ffffff;
      padding: 16px 32px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
  </style>
</head>
<body>
  <section class="hero">
    <h1>Composable Commerce API</h1>
    <div role="button" tabindex="0" class="div-cta">Explore Platform</div>
  </section>
</body>
</html>`);
        return;
      }

      // Edge case 5: A page with no genuine conversion CTA
      if (urlPath === '/cta-no-conversion.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Page With No Conversion CTA</title>
  <style>
    body { background-color: #ffffff; color: #1e293b; font-family: serif; max-width: 700px; margin: 40px auto; }
    h1 { color: #0f172a; }
    p { line-height: 1.6; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <article>
    <h1>Historical Notes on Design Systems</h1>
    <p>Design systems have evolved from static styleguides into dynamic token pipelines.</p>
    <p>Read the <a href="/archive">full archive</a> for historical reference.</p>
  </article>
</body>
</html>`);
        return;
      }

      // Responsive extraction fixture: custom media queries, 3-2-1 grid, fluid clamp, navigation collapse
      if (urlPath === '/responsive.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Responsive Design System Benchmark</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --primary: #38bdf8;
      --text: #f8fafc;
      --muted: #94a3b8;
      --border: #334155;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Geist Sans', -apple-system, sans-serif;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 24px;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .nav-links {
      display: flex;
      gap: 24px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .hamburger-btn {
      display: none;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
    }
    section.hero {
      padding: 80px 24px;
      text-align: center;
    }
    h1.hero-title {
      font-size: 48px;
      line-height: 1.15;
      font-weight: 700;
      margin: 0 0 16px 0;
    }
    .fluid-tagline {
      font-size: clamp(1.25rem, 1rem + 1.5vw, 2rem);
      color: var(--muted);
      margin-bottom: 32px;
    }
    .btn-cta {
      display: inline-block;
      background: var(--primary);
      color: #0f172a;
      padding: 14px 28px;
      border-radius: 8px;
      font-weight: 600;
      text-decoration: none;
      width: auto;
    }
    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      padding: 40px 0;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }

    /* Custom Breakpoint 1: Tablet threshold at max-width: 1080px */
    @media (max-width: 1080px) {
      section.hero {
        padding: 48px 20px;
      }
      h1.hero-title {
        font-size: 36px;
      }
      .features-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 20px;
      }
      .hamburger-btn {
        display: inline-block;
      }
    }

    /* Custom Breakpoint 2: Mobile threshold at max-width: 680px */
    @media (max-width: 680px) {
      section.hero {
        padding: 24px 16px;
      }
      h1.hero-title {
        font-size: 28px;
      }
      .features-grid {
        grid-template-columns: 1fr;
        gap: 16px;
      }
      .nav-links {
        display: none;
      }
      .btn-cta {
        display: block;
        width: 100%;
        box-sizing: border-box;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">Styleprobe</div>
    <ul class="nav-links">
      <li><a href="#features">Features</a></li>
      <li><a href="#pricing">Pricing</a></li>
      <li><a href="#docs">Docs</a></li>
    </ul>
    <button class="hamburger-btn" aria-label="Toggle navigation menu">☰</button>
  </header>
  <main class="container">
    <section class="hero">
      <h1 class="hero-title">Next-Gen Responsive Design Systems</h1>
      <p class="fluid-tagline">Visual DNA extraction across viewports</p>
      <a href="#start" class="btn-cta">Start Free Probing</a>
    </section>
    <section class="features-grid">
      <div class="card"><h3>Token Extraction</h3><p>Extract colors, fonts, and shadows.</p></div>
      <div class="card"><h3>Responsive Behavior</h3><p>Identify fluid clamp and media queries.</p></div>
      <div class="card"><h3>Agent Integration</h3><p>Export directly to CLAUDE.md & AGENTS.md.</p></div>
    </section>
  </main>
</body>
</html>`);
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
