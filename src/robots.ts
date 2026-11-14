import { validateAndResolveUrl } from './security.js';

export interface RobotsRules {
  disallows: string[];
  allows: string[];
}

/**
 * Parses a robots.txt file for User-agent: * or styleprobe.
 */
export function parseRobotsTxt(content: string): RobotsRules {
  const disallows: string[] = [];
  const allows: string[] = [];

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

    if (directive === 'user-agent') {
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

  return { disallows, allows };
}

/**
 * Checks if a path is permitted under the parsed robots.txt rules.
 * Follows RFC 9309: longest matching prefix wins; Allow wins in case of tie.
 */
export function isAllowedByRobots(path: string, rules: RobotsRules): boolean {
  if (!rules || (rules.disallows.length === 0 && rules.allows.length === 0)) {
    return true;
  }

  const cleanPath = path || '/';
  let bestMatchLen = -1;
  let isAllowed = true;

  // Check allows
  for (const allow of rules.allows) {
    if (cleanPath.startsWith(allow)) {
      if (allow.length > bestMatchLen) {
        bestMatchLen = allow.length;
        isAllowed = true;
      }
    }
  }

  // Check disallows
  for (const disallow of rules.disallows) {
    if (cleanPath.startsWith(disallow)) {
      if (disallow.length > bestMatchLen) {
        bestMatchLen = disallow.length;
        isAllowed = false;
      }
    }
  }

  return isAllowed;
}

/**
 * Fetches and parses robots.txt for a given origin with SSRF protection and a fast 3s timeout.
 */
export async function fetchRobotsTxt(originUrl: string): Promise<RobotsRules> {
  const emptyRules: RobotsRules = { disallows: [], allows: [] };

  try {
    const origin = new URL(originUrl).origin;
    const robotsUrl = `${origin}/robots.txt`;

    const sec = await validateAndResolveUrl(robotsUrl);
    if (!sec.safe) return emptyRules;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'styleprobe/1.0 (+https://github.com/spidervirus/styleprobe)',
        'Accept': 'text/plain'
      }
    });
    clearTimeout(timeoutId);

    if (!res.ok) return emptyRules;

    const text = await res.text();
    return parseRobotsTxt(text);
  } catch {
    return emptyRules;
  }
}
