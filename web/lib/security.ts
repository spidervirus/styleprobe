import dns from 'node:dns/promises';
import net from 'node:net';

export interface SecurityCheckResult {
  safe: boolean;
  reason?: string;
  normalizedUrl?: string;
  resolvedIps?: string[];
}

const BLOCKED_PORTS = new Set([
  20, 21, 22, 23, 25, 53, 67, 68, 69, 110, 123, 135, 137, 138, 139,
  143, 161, 162, 389, 636, 445, 1433, 1521, 2049, 2375, 2376, 3306,
  3389, 5432, 5900, 6379, 9200, 9300, 11211, 27017, 27018
]);

const BLOCKED_HOST_SUFFIXES = [
  'localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  'metadata.google.internal',
  'instance-data'
];

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 — fail closed
  }

  const [b0, b1, b2] = parts;

  if (b0 === 0) return true;                                // 0.0.0.0/8
  if (b0 === 10) return true;                               // 10.0.0.0/8
  if (b0 === 127) return true;                              // 127.0.0.0/8
  if (b0 === 169 && b1 === 254) return true;                // 169.254.0.0/16
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;      // 172.16.0.0/12
  if (b0 === 192 && b1 === 168) return true;                // 192.168.0.0/16
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;     // 100.64.0.0/10
  if (b0 === 192 && b1 === 0 && (b2 === 0 || b2 === 2)) return true;
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;  // 198.18.0.0/15
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;  // 198.51.100.0/24
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;   // 203.0.113.0/24
  if (b0 >= 224 && b0 <= 239) return true;                  // 224.0.0.0/4 (multicast)
  if (b0 >= 240) return true;                               // 240.0.0.0/4 (reserved)

  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  if (normalized === '::1' || normalized === '::') return true;

  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice(7);
    if (net.isIPv4(v4Part)) return isPrivateIPv4(v4Part);
    const parts = v4Part.split(':');
    if (parts.length === 2) {
      const p1 = parseInt(parts[0], 16);
      const p2 = parseInt(parts[1], 16);
      if (!isNaN(p1) && !isNaN(p2)) {
        const reconstituted = `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
        return isPrivateIPv4(reconstituted);
      }
    }
    return true;
  }

  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/i.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8:') || normalized.startsWith('100::')) return true;

  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();
  const clean = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;

  if (clean === 'localhost' || clean.endsWith('.localhost')) return true;
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (clean === suffix || clean.endsWith(suffix)) return true;
  }

  if (net.isIP(clean) !== 0) {
    return isPrivateOrReservedIp(clean);
  }

  return false;
}

export async function resolveAndVerifyHostname(hostname: string): Promise<{ safe: boolean; reason?: string; ips: string[] }> {
  const cleanHost = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');

  if (isBlockedHostname(cleanHost)) {
    return { safe: false, reason: `Hostname '${cleanHost}' is blocked (local, private, or metadata service)`, ips: [] };
  }

  if (net.isIP(cleanHost) !== 0) {
    if (isPrivateOrReservedIp(cleanHost)) {
      return { safe: false, reason: `IP '${cleanHost}' is in a private, loopback, or cloud metadata range`, ips: [cleanHost] };
    }
    return { safe: true, ips: [cleanHost] };
  }

  try {
    const records = await dns.lookup(cleanHost, { all: true });
    if (!records || records.length === 0) {
      return { safe: false, reason: `Hostname '${cleanHost}' could not be resolved`, ips: [] };
    }

    const ips = records.map(r => r.address);
    for (const ip of ips) {
      if (isPrivateOrReservedIp(ip)) {
        return {
          safe: false,
          reason: `SSRF blocked: '${cleanHost}' resolves to internal IP '${ip}'`,
          ips
        };
      }
    }
    return { safe: true, ips };
  } catch (err: any) {
    return { safe: false, reason: `DNS lookup failed for '${cleanHost}': ${err.message}`, ips: [] };
  }
}

export async function validateAndResolveUrl(rawUrl: string): Promise<SecurityCheckResult> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { safe: false, reason: 'URL must be a non-empty string' };
  }

  const trimmed = rawUrl.trim();

  // Reject unsupported protocols immediately
  const lowerTrimmed = trimmed.toLowerCase();
  const protocolMatch = lowerTrimmed.match(/^([a-z0-9+.-]+):/);
  if (protocolMatch) {
    const proto = protocolMatch[1];
    if (proto !== 'http' && proto !== 'https') {
      return { safe: false, reason: `Disallowed protocol '${proto}:'. Only http: and https: are permitted.` };
    }
  }

  const urlWithScheme = (trimmed.startsWith('http://') || trimmed.startsWith('https://'))
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(urlWithScheme);
  } catch {
    return { safe: false, reason: `Malformed URL: '${rawUrl}'` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Disallowed protocol '${parsed.protocol}'. Only http: and https: are permitted.` };
  }

  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'URLs with embedded user credentials (user:pass@) are prohibited' };
  }

  if (parsed.port) {
    const portNum = parseInt(parsed.port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return { safe: false, reason: `Invalid port '${parsed.port}'` };
    }
    if (BLOCKED_PORTS.has(portNum)) {
      return { safe: false, reason: `Access to port ${portNum} is blocked for security` };
    }
  }

  const dnsResult = await resolveAndVerifyHostname(parsed.hostname);
  if (!dnsResult.safe) {
    return { safe: false, reason: dnsResult.reason, resolvedIps: dnsResult.ips };
  }

  return {
    safe: true,
    normalizedUrl: parsed.toString(),
    resolvedIps: dnsResult.ips
  };
}
