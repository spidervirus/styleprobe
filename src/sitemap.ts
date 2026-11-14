import { validateAndResolveUrl } from './security.js';
import { RobotsRules, isAllowedByRobots } from './robots.js';

export const MAX_SITEMAP_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per sitemap document
export const MAX_SITEMAP_RECURSION_DEPTH = 2; // Level 0: Index -> Level 1: Child sitemaps -> Level 2: Stop
export const MAX_SITEMAP_DOCS_FETCHED = 8; // Hard limit on total sitemap documents fetched per discovery session

const DEFAULT_SITEMAP_CANDIDATES = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml'
];

const EXCLUDED_EXTENSIONS = /\.(pdf|zip|tar|gz|exe|dmg|iso|png|jpe?g|gif|svg|webp|ico|mp4|webm|mp3|wav|csv|docx?|xlsx?|pptx?|css|js|json|xml|rss|woff2?|ttf|eot)$/i;
const EXCLUDED_PATHS = /\/(login|signin|logout|signout|signup|register|auth|cart|checkout|privacy|terms|legal|cookie-policy|cookies|gdpr|wp-admin|wp-content|api|cdn-cgi)\b/i;

const HIGH_VALUE_PATHS = /\/(components|design|docs|documentation|ui|elements|buttons|theme|tokens|styles|patterns)\b/i;
const MID_VALUE_PATHS  = /\/(features|product|pricing|about|showcase|templates|examples|overview)\b/i;

export function scoreUrl(path: string): number {
  if (HIGH_VALUE_PATHS.test(path)) return 10;
  if (MID_VALUE_PATHS.test(path)) return 5;
  return 1;
}

/**
 * Normalizes a sitemap URL for deduplication and cycle prevention.
 */
export function normalizeSitemapUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    u.hash = '';
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Extracts <loc>...</loc> URLs from XML sitemap contents.
 */
export function extractLocUrls(xml: string): string[] {
  const urls: string[] = [];
  const locRegex = /<loc>(https?:\/\/[^<]+)<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * Safely fetches XML content with:
 * 1. Pre-flight and post-redirect SSRF validation
 * 2. Redirect following (up to 3 hops) with same-origin enforcement
 * 3. Cyclic redirect loop prevention
 * 4. Strict size limit enforcement (MAX_SITEMAP_SIZE_BYTES)
 * 5. 4-second timeout
 */
export async function fetchXmlSafe(
  targetUrl: string,
  allowedOrigin: string,
  timeoutMs = 4000
): Promise<string | null> {
  let currentUrl = targetUrl;
  const maxHops = 3;
  let hops = 0;
  const seenRedirects = new Set<string>([normalizeSitemapUrl(currentUrl)]);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    while (hops < maxHops) {
      // Validate current URL against SSRF
      const sec = await validateAndResolveUrl(currentUrl);
      if (!sec.safe) return null;

      const res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'styleprobe/1.0 (+https://github.com/spidervirus/styleprobe)',
          'Accept': 'application/xml, text/xml, */*'
        }
      });

      // Handle HTTP redirects
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return null;
        const nextUrl = new URL(loc, currentUrl).toString();
        const normNext = normalizeSitemapUrl(nextUrl);

        // Cyclic redirect loop prevention
        if (seenRedirects.has(normNext)) {
          return null; // Loop detected
        }
        seenRedirects.add(normNext);

        // Enforce same-origin across redirects
        if (new URL(nextUrl).origin !== allowedOrigin) {
          return null;
        }

        currentUrl = nextUrl;
        hops++;
        continue;
      }

      if (!res.ok) return null;

      // Check Content-Length header if present
      const contentLengthHeader = res.headers.get('content-length');
      if (contentLengthHeader) {
        const len = parseInt(contentLengthHeader, 10);
        if (!isNaN(len) && len > MAX_SITEMAP_SIZE_BYTES) {
          return null; // Exceeds size limit
        }
      }

      // Stream response to strictly enforce byte limit even without content-length header
      if (res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.length;
            if (totalBytes > MAX_SITEMAP_SIZE_BYTES) {
              await reader.cancel();
              return null; // Size limit exceeded
            }
            chunks.push(value);
          }
        }

        const buffer = Buffer.concat(chunks);
        return buffer.toString('utf-8');
      }

      const text = await res.text();
      if (text.length > MAX_SITEMAP_SIZE_BYTES) return null;
      return text;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface SitemapFetchTracker {
  fetchedCount: number;
}

/**
 * Recursively parses sitemaps up to MAX_SITEMAP_RECURSION_DEPTH.
 * Handles <sitemapindex> structures, redirects, size bounds, and robots.txt filtering.
 * Enforces cycle prevention, duplicate avoidance, and hard document fetch limits.
 */
async function crawlSitemapRecursive(
  sitemapUrl: string,
  origin: string,
  depth: number,
  robotsRules: RobotsRules | undefined,
  collected: Array<{ url: string; score: number }>,
  visitedSitemaps: Set<string>,
  tracker: SitemapFetchTracker,
  maxBudget: number
): Promise<void> {
  if (depth > MAX_SITEMAP_RECURSION_DEPTH) return;
  if (tracker.fetchedCount >= MAX_SITEMAP_DOCS_FETCHED) return;

  const normalized = normalizeSitemapUrl(sitemapUrl);
  if (visitedSitemaps.has(normalized)) return;
  visitedSitemaps.add(normalized);

  tracker.fetchedCount++;
  const xml = await fetchXmlSafe(sitemapUrl, origin);
  if (!xml || xml.indexOf('<loc>') === -1) return;

  const locs = extractLocUrls(xml);

  // If this is a sitemapindex, recurse into child sitemaps
  if (xml.indexOf('<sitemapindex') !== -1) {
    for (const childUrl of locs) {
      if (tracker.fetchedCount >= MAX_SITEMAP_DOCS_FETCHED) break; // Hard limit reached
      if (collected.length >= maxBudget * 3) break; // Budget limit reached
      try {
        const u = new URL(childUrl);
        if (u.origin !== origin) continue;
        if (robotsRules && !isAllowedByRobots(u.pathname, robotsRules)) continue;

        const normChild = normalizeSitemapUrl(childUrl);
        if (visitedSitemaps.has(normChild)) continue; // Cyclic / duplicate child sitemap prevention

        await crawlSitemapRecursive(childUrl, origin, depth + 1, robotsRules, collected, visitedSitemaps, tracker, maxBudget);
      } catch {}
    }
    return;
  }

  // Regular sitemap: extract page URLs
  for (const loc of locs) {
    if (collected.length >= maxBudget * 4) break;
    try {
      const u = new URL(loc);
      if (u.origin !== origin) continue;
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;

      const pathname = u.pathname;
      if (EXCLUDED_EXTENSIONS.test(pathname) || EXCLUDED_PATHS.test(pathname)) continue;

      // Enforce robots.txt rules on discovered URLs
      if (robotsRules && !isAllowedByRobots(pathname, robotsRules)) continue;

      collected.push({ url: u.toString(), score: scoreUrl(pathname) });
    } catch {}
  }
}

/**
 * Discovers and extracts prioritized URLs from sitemaps for the given origin.
 * Enforces same-origin, SSRF protection, size limits, redirect validation,
 * robots.txt compliance, cyclic index prevention, duplicate sitemap prevention,
 * sitemap index recursion, and page-budget enforcement.
 *
 * @param originUrl The root or origin URL of the target site.
 * @param maxEntries The maximum number of prioritized URLs to return (page budget).
 * @param robotsRules Optional parsed robots.txt rules to filter sitemap URLs.
 * @returns An array of prioritized, validated same-origin URLs.
 */
export async function discoverSitemapUrls(
  originUrl: string,
  maxEntries = 15,
  robotsRules?: RobotsRules
): Promise<string[]> {
  const discovered: string[] = [];

  try {
    const origin = new URL(originUrl).origin;

    // Gather candidate URLs: explicitly declared in robots.txt first, then standard paths
    const candidates: string[] = [];
    if (robotsRules?.sitemaps && robotsRules.sitemaps.length > 0) {
      for (const sm of robotsRules.sitemaps) {
        try {
          const u = new URL(sm);
          if (u.origin === origin) candidates.push(normalizeSitemapUrl(u.toString()));
        } catch {}
      }
    }

    for (const path of DEFAULT_SITEMAP_CANDIDATES) {
      const standardUrl = normalizeSitemapUrl(`${origin}${path}`);
      if (!candidates.includes(standardUrl)) {
        candidates.push(standardUrl);
      }
    }

    const collected: Array<{ url: string; score: number }> = [];
    const visitedSitemaps = new Set<string>();
    const tracker: SitemapFetchTracker = { fetchedCount: 0 };

    for (const candidate of candidates) {
      if (tracker.fetchedCount >= MAX_SITEMAP_DOCS_FETCHED) break;

      await crawlSitemapRecursive(
        candidate,
        origin,
        0,
        robotsRules,
        collected,
        visitedSitemaps,
        tracker,
        maxEntries
      );

      // If valid URLs were discovered from this candidate or candidate sitemapindex, stop probing other candidates
      if (collected.length > 0) break;
    }

    // Sort by design relevance score descending
    collected.sort((a, b) => b.score - a.score);

    // Apply strict page budget (maxEntries) and eliminate duplicates
    for (const item of collected) {
      if (!discovered.includes(item.url)) {
        discovered.push(item.url);
        if (discovered.length >= maxEntries) break;
      }
    }
  } catch {}

  return discovered;
}
