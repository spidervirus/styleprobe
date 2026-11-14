import { validateAndResolveUrl } from './security.js';

export interface RobotsRules {
  disallows: string[];
  allows: string[];
  sitemaps: string[];
}

/**
 * Parses a robots.txt file for User-agent: * or styleprobe, and extracts any Sitemap directives.
 */
export function parseRobotsTxt(content: string): RobotsRules {
  const disallows: string[] = [];
  const allows: string[] = [];
  const sitemaps: string[] = [];

  const lines = content.split('\n');
  let appliesToUs = false;

  for (let line of lines) {
    // Strip comments
    const commentIdx = line.indexOf('#');
    if (commentIdx !== -1) {
      line = line.slice(0, commentIdx);
    }
    line = line.trim();
    if (!line) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (directive === 'user-agent') {
      const agent = value.toLowerCase();
      appliesToUs = agent === '*' || agent === 'styleprobe';
    } else if (appliesToUs) {
      if (directive === 'disallow') {
        if (value) disallows.push(value);
      } else if (directive === 'allow') {
        if (value) allows.push(value);
      }
    }
  }

  return { disallows, allows, sitemaps };
}

/**
 * Compiles an RFC 9309 robots.txt pattern to a Regular Expression.
 *
 * RFC 9309 Section 2.2.2 (Matching Records):
 * - '*' matches 0 or more instances of any valid character.
 * - '$' at the end of the pattern designates the end of the matching path.
 * - If no '$' is present at the end, the pattern matches as a prefix (implicit wildcard).
 */
export function compileRobotsPattern(pattern: string): RegExp {
  const hasEndAnchor = pattern.endsWith('$');
  const base = hasEndAnchor ? pattern.slice(0, -1) : pattern;

  // Escape special regex characters except '*'
  let escaped = base.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&');

  // Replace '*' with '.*'
  escaped = escaped.replace(/\*/g, '.*');

  // Must match from the start of the path
  const regexStr = '^' + escaped + (hasEndAnchor ? '$' : '');
  return new RegExp(regexStr);
}

/**
 * Checks if a path matches an RFC 9309 robots.txt rule pattern.
 */
export function matchesRobotsPattern(pattern: string, path: string): boolean {
  if (!pattern) return false;
  try {
    const rx = compileRobotsPattern(pattern);
    return rx.test(path);
  } catch {
    return path.startsWith(pattern);
  }
}

/**
 * Checks if a path is permitted under the parsed robots.txt rules.
 * Follows RFC 9309 Section 2.2.2:
 * 1. The most specific rule (longest matching pattern by length in characters) takes precedence.
 * 2. If an Allow and a Disallow rule have equal length, Allow takes precedence.
 * 3. Standard wildcards (*) and end-anchors ($) are fully evaluated.
 * 4. If no rules match, access is allowed.
 */
export function isAllowedByRobots(path: string, rules: RobotsRules): boolean {
  if (!rules || (rules.disallows.length === 0 && rules.allows.length === 0)) {
    return true;
  }

  const cleanPath = path ? (path.startsWith('/') ? path : '/' + path) : '/';

  interface MatchedRule {
    pattern: string;
    type: 'allow' | 'disallow';
    length: number;
  }

  const matches: MatchedRule[] = [];

  for (const allow of rules.allows) {
    if (matchesRobotsPattern(allow, cleanPath)) {
      matches.push({ pattern: allow, type: 'allow', length: allow.length });
    }
  }

  for (const disallow of rules.disallows) {
    if (matchesRobotsPattern(disallow, cleanPath)) {
      matches.push({ pattern: disallow, type: 'disallow', length: disallow.length });
    }
  }

  if (matches.length === 0) {
    return true;
  }

  // Sort matches by length descending; in tie-break, 'allow' comes before 'disallow'
  matches.sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    if (a.type === 'allow' && b.type === 'disallow') return -1;
    if (a.type === 'disallow' && b.type === 'allow') return 1;
    return 0;
  });

  return matches[0].type === 'allow';
}

/**
 * Fetches and parses robots.txt for a given origin with SSRF protection,
 * redirect validation, and a fast 3s timeout.
 * Returns empty rules (fails open / permissive) on network failures, 4xx, 5xx, or timeouts.
 */
export async function fetchRobotsTxt(originUrl: string): Promise<RobotsRules> {
  const emptyRules: RobotsRules = { disallows: [], allows: [], sitemaps: [] };

  try {
    const parsed = new URL(originUrl);
    const origin = parsed.origin;
    let currentUrl = (parsed.pathname && parsed.pathname.endsWith('.txt'))
      ? parsed.toString()
      : `${origin}/robots.txt`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const maxHops = 3;
    let hops = 0;

    try {
      while (hops < maxHops) {
        const sec = await validateAndResolveUrl(currentUrl);
        if (!sec.safe) return emptyRules;

        const res = await fetch(currentUrl, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': 'styleprobe/1.0 (+https://github.com/spidervirus/styleprobe)',
            'Accept': 'text/plain'
          }
        });

        // Handle redirects safely
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) return emptyRules;
          const nextUrl = new URL(loc, currentUrl).toString();
          // Stay on same origin for robots.txt
          if (new URL(nextUrl).origin !== origin) {
            return emptyRules;
          }
          currentUrl = nextUrl;
          hops++;
          continue;
        }

        if (!res.ok) return emptyRules;

        const text = await res.text();
        return parseRobotsTxt(text);
      }
      return emptyRules;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return emptyRules;
  }
}
