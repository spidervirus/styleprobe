import dns from 'node:dns/promises';
import net from 'node:net';

export interface SecurityCheckResult {
  safe: boolean;
  reason?: string;
  normalizedUrl?: string;
  resolvedIps?: string[];
}

// Disallowed internal and non-web port numbers
const BLOCKED_PORTS = new Set([
  20, 21,    // FTP
  22,        // SSH
  23,        // Telnet
  25,        // SMTP
  53,        // DNS
  67, 68,    // DHCP
  69,        // TFTP
  110,       // POP3
  123,       // NTP
  135, 137, 138, 139, // NetBIOS / SMB
  143,       // IMAP
  161, 162,  // SNMP
  389, 636,  // LDAP
  445,       // SMB
  1433,      // MSSQL
  1521,      // Oracle
  2049,      // NFS
  2375, 2376,// Docker
  3306,      // MySQL
  3389,      // RDP
  5432,      // PostgreSQL
  5900,      // VNC
  6379,      // Redis
  9200, 9300,// Elasticsearch
  11211,     // Memcached
  27017, 27018 // MongoDB
]);

// Hostnames prohibited outright without DNS
const BLOCKED_HOST_SUFFIXES = [
  'localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  'metadata.google.internal',
  'instance-data'
];

/**
 * Checks if a string represents an IPv4 address in private, loopback, link-local,
 * CGNAT, multicast, or reserved ranges (RFC 1918, RFC 1122, RFC 3927, RFC 6598).
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 — fail closed
  }

  const [b0, b1, b2] = parts;

  // Allow 127.0.0.1 only when explicit test environment variable is active
  if (process.env.STYLEPROBE_TEST_ALLOW_LOCAL === '1' && b0 === 127) {
    return false;
  }

  // 0.0.0.0/8 (Current network)
  if (b0 === 0) return true;
  // 10.0.0.0/8 (RFC 1918 Private)
  if (b0 === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;
  // 169.254.0.0/16 (Link Local / Cloud Instance Metadata)
  if (b0 === 169 && b1 === 254) return true;
  // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  // 192.168.0.0/16 (RFC 1918 Private)
  if (b0 === 192 && b1 === 168) return true;
  // 100.64.0.0/10 (CGNAT / Shared: 100.64.0.0 - 100.127.255.255)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
  // 192.0.0.0/24 (IETF Assignments), 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 0 && (b2 === 0 || b2 === 2)) return true;
  // 198.18.0.0/15 (Benchmarking: 198.18.0.0 - 198.19.255.255)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;
  // 224.0.0.0/4 (Multicast: 224 - 239)
  if (b0 >= 224 && b0 <= 239) return true;
  // 240.0.0.0/4 (Reserved / Future: 240 - 255)
  if (b0 >= 240) return true;

  return false;
}

/**
 * Checks if a string represents an IPv6 address in private, loopback, link-local,
 * unique local, IPv4-mapped, or reserved ranges.
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // Loopback (::1) and Unspecified (::)
  if (normalized === '::1' || normalized === '::') return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:169.254.169.254, etc.)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateIPv4(v4Part);
    }
    // Hex IPv4-mapped: ::ffff:7f00:0001
    const parts = v4Part.split(':');
    if (parts.length === 2) {
      const p1 = parseInt(parts[0], 16);
      const p2 = parseInt(parts[1], 16);
      if (!isNaN(p1) && !isNaN(p2)) {
        const reconstituted = `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
        return isPrivateIPv4(reconstituted);
      }
    }
    return true; // Fail closed if unrecognized ::ffff: mapping
  }

  // Unique Local Addresses (fc00::/7 -> fc00.. or fd00..)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-Local Unicast (fe80::/10 -> fe80.. through febf..)
  if (/^fe[89ab]/i.test(normalized)) return true;

  // Multicast (ff00::/8)
  if (normalized.startsWith('ff')) return true;

  // Documentation / discarded
  if (normalized.startsWith('2001:db8:') || normalized.startsWith('100::')) return true;

  return false;
}

/**
 * Checks if an IP (v4 or v6) is private or reserved.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // Not a valid IP — fail closed
}

/**
 * Checks if a hostname matches any blocked patterns or metadata service names.
 */
export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();

  // Strip brackets if IPv6
  const clean = lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;

  if (process.env.STYLEPROBE_TEST_ALLOW_LOCAL === '1' && (clean === 'localhost' || clean === '127.0.0.1')) {
    return false;
  }

  if (clean === 'localhost' || clean.endsWith('.localhost')) return true;
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (clean === suffix || clean.endsWith(suffix)) return true;
  }

  // Direct IP literal checks
  if (net.isIP(clean) !== 0) {
    return isPrivateOrReservedIp(clean);
  }

  return false;
}

/**
 * In-memory DNS cache to protect against rebinding while avoiding excessive lookups
 * during multi-asset page evaluation.
 */
const dnsCache = new Map<string, { ips: string[]; timestamp: number; safe: boolean }>();
const DNS_CACHE_TTL_MS = 15000; // 15 seconds

/**
 * Resolves a hostname to all associated IPs and verifies every single one against SSRF rules.
 * This directly prevents DNS Rebinding attacks.
 */
export async function resolveAndVerifyHostname(hostname: string): Promise<{ safe: boolean; reason?: string; ips: string[] }> {
  const cleanHost = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');

  // Check hostname syntax and blacklist
  if (isBlockedHostname(cleanHost)) {
    return { safe: false, reason: `Hostname '${cleanHost}' is blocked (local, private, or metadata service)`, ips: [] };
  }

  // If it's already an IP literal
  if (net.isIP(cleanHost) !== 0) {
    if (isPrivateOrReservedIp(cleanHost)) {
      return { safe: false, reason: `IP '${cleanHost}' is in a private, loopback, or cloud metadata range`, ips: [cleanHost] };
    }
    return { safe: true, ips: [cleanHost] };
  }

  // Check cache
  const cached = dnsCache.get(cleanHost);
  if (cached && (Date.now() - cached.timestamp < DNS_CACHE_TTL_MS)) {
    if (!cached.safe) {
      return { safe: false, reason: `Hostname '${cleanHost}' resolved to a private/internal IP`, ips: cached.ips };
    }
    return { safe: true, ips: cached.ips };
  }

  try {
    const records = await dns.lookup(cleanHost, { all: true });
    if (!records || records.length === 0) {
      return { safe: false, reason: `Hostname '${cleanHost}' could not be resolved`, ips: [] };
    }

    const ips = records.map(r => r.address);

    for (const ip of ips) {
      if (isPrivateOrReservedIp(ip)) {
        dnsCache.set(cleanHost, { ips, timestamp: Date.now(), safe: false });
        return {
          safe: false,
          reason: `DNS Rebinding / SSRF blocked: '${cleanHost}' resolved to internal IP '${ip}'`,
          ips
        };
      }
    }

    dnsCache.set(cleanHost, { ips, timestamp: Date.now(), safe: true });
    return { safe: true, ips };
  } catch (err: any) {
    return { safe: false, reason: `DNS lookup failed for '${cleanHost}': ${err.message}`, ips: [] };
  }
}

/**
 * Full URL input validation: protocol, credentials, port, hostname, and resolved DNS IPs.
 */
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

  // 1. Protocol validation: HTTP and HTTPS only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Disallowed protocol '${parsed.protocol}'. Only http: and https: are permitted.` };
  }

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'URLs with embedded user credentials (user:pass@) are prohibited' };
  }

  // 3. Port validation
  if (parsed.port) {
    const portNum = parseInt(parsed.port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return { safe: false, reason: `Invalid port '${parsed.port}'` };
    }
    if (BLOCKED_PORTS.has(portNum)) {
      return { safe: false, reason: `Access to port ${portNum} is blocked for security` };
    }
  }

  // 4. DNS resolution and SSRF / DNS rebinding protection
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
