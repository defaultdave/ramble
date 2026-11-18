const maxAddressLength = 45;
const addressShape = /^[0-9a-f:.]+$/;
const hexGroup = /^[0-9a-f]{1,4}$/;
const decimalOctet = /^\d{1,3}$/;

function parseHexGroups(side: string): number[] | null {
  if (side === '') return [];
  const groups: number[] = [];
  for (const token of side.split(':')) {
    if (!hexGroup.test(token)) return null;
    groups.push(Number.parseInt(token, 16));
  }
  return groups;
}

/** Like `parseHexGroups`, but the last token may be a dotted IPv4 tail, worth two groups. */
function parseTail(side: string): number[] | null {
  const lastColon = side.lastIndexOf(':');
  const last = side.slice(lastColon + 1);
  if (!last.includes('.')) return parseHexGroups(side);
  const octets = last.split('.');
  if (
    octets.length !== 4 ||
    !octets.every((o) => decimalOctet.test(o) && Number(o) <= 255)
  ) {
    return null;
  }
  const [a, b, c, d] = octets.map(Number) as [number, number, number, number];
  const head = parseHexGroups(side.slice(0, Math.max(lastColon, 0)));
  return head && [...head, a * 256 + b, c * 256 + d];
}

function parseIpv6(text: string): number[] | null {
  const halves = text.split('::');
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const groups = parseTail(text);
    return groups?.length === 8 ? groups : null;
  }
  const head = parseHexGroups(halves[0] ?? '');
  const tail = parseTail(halves[1] ?? '');
  if (!head || !tail || head.length + tail.length > 7) return null;
  return [
    ...head,
    ...Array<number>(8 - head.length - tail.length).fill(0),
    ...tail,
  ];
}

function ipv6Key(text: string): string {
  const groups = parseIpv6(text);
  if (!groups) return 'unknown';
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0xffff
  ) {
    const octets = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
    return `::ffff:${octets.join('.')}`;
  }
  return `${[g0, g1, g2, g3].map((g) => g.toString(16)).join(':')}::/64`;
}

/**
 * The caller's network, as one lower-case string that can key a rate limit. Vercel sets
 * `x-forwarded-for` itself and drops client-supplied values, so its first entry is the client.
 * An IPv6 client is keyed by its /64 prefix, not the whole address: one customer holds a whole /64
 * and can rotate the low 64 bits on every request, so a per-address key would give each request a
 * fresh count. An IPv4-mapped IPv6 address is an IPv4 client and keeps its dotted form. Anything
 * absent, over-long, not shaped like an address, or a malformed IPv6 collapses to one shared
 * "unknown", so a forged header can neither grow the key space nor dodge a limit.
 */
export function clientAddress(forwardedFor: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim().toLowerCase() ?? '';
  if (
    first.length === 0 ||
    first.length > maxAddressLength ||
    !addressShape.test(first)
  ) {
    return 'unknown';
  }
  return first.includes(':') ? ipv6Key(first) : first;
}
