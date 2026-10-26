/**
 * Redaction for everything that leaves the process as a log line, a Sentry event, or an alert.
 *
 * Two layers, both fail closed:
 * - key rules: a field whose name suggests a secret, token, card, email, name, contact detail, or
 *   database query text loses its whole value, whatever it holds;
 * - value rules: every string is scanned for emails, card numbers, bearer and API tokens, JWTs,
 *   URL credentials, capability-link path segments, `password=` style pairs, cookie headers,
 *   database query parameters, and long opaque tokens, wherever they appear (messages, nested
 *   fields, error text, stack traces). Numbers and bigints are checked for card numbers too.
 *
 * Errors are rebuilt from an allowlist (name, message, stack, code, cause) so driver-specific
 * properties such as a Postgres `detail` or a Drizzle `params` (both quote row values) never travel.
 *
 * Every walk is bounded: depth, items per array, keys per object, total nodes, total characters,
 * and the length of text any pattern scans. Nothing here throws: a value that cannot be read
 * becomes a placeholder.
 */

export const REDACTED = '[redacted]';
export const TRUNCATED = '[truncated]';
export const UNREDACTABLE = '[unredactable]';

export type RedactLimits = {
  maxDepth: number;
  maxStringLength: number;
  maxArrayItems: number;
  maxKeys: number;
  /** Values visited in one call, counting every array item, key, and primitive. */
  maxNodes: number;
  /** Characters kept across every string in one call. */
  maxTotalChars: number;
};

export const defaultLimits: RedactLimits = {
  maxDepth: 6,
  maxStringLength: 2_000,
  maxArrayItems: 50,
  maxKeys: 100,
  maxNodes: 1_000,
  maxTotalChars: 16_000,
};

const maxKeyLength = 100;
const maxStackLength = 4_000;
/** Patterns scan at most this many times the length the caller will keep. */
const scanFactor = 4;
/** How far back the cut drops an unfinished token, so a secret is not left half visible. */
const maxPartialToken = 128;

// A key is matched after lowercasing and dropping every non-alphanumeric character, so
// `Set-Cookie`, `set_cookie`, and `setCookie` are one key.
const sensitiveKeyFragments = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'accesskey',
  'privatekey',
  'credential',
  'signature',
  'bearer',
  'csrf',
  'cardnumber',
  'cardholder',
  'cvc',
  'cvv',
  'securitycode',
  'iban',
  'routingnumber',
  'accountnumber',
  'ssn',
  'email',
  'phone',
  'guardian',
  'birth',
  'firstname',
  'lastname',
  'fullname',
  'guestname',
  'givenname',
  'familyname',
];

// Short names that would over-match as fragments (`pan` in "expand", `pin` in "shipping").
const sensitiveKeyExact = new Set([
  'card',
  'pan',
  'pin',
  'otp',
  'dsn',
  'sig',
  'auth',
  'dob',
  'mail',
  'tel',
  'cvn',
  'name',
  // Database error and query fields: they quote the statement or the row (Postgres `detail`,
  // Drizzle `query` and `params`, node-postgres `where`).
  'detail',
  'parameters',
  'params',
  'query',
  'where',
  'sql',
  'statement',
  'internalquery',
]);

// Words that mark a secret only as a field name. In running text ("Failed query: select ...",
// "name: deliver_gift") they are ordinary words, so the text rules skip them.
const fieldOnlyKeys = new Set([
  'name',
  'detail',
  'parameters',
  'params',
  'query',
  'where',
  'sql',
  'statement',
  'internalquery',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (sensitiveKeyExact.has(normalized)) return true;
  return sensitiveKeyFragments.some((fragment) =>
    normalized.includes(fragment),
  );
}

function isSensitiveTextName(name: string): boolean {
  return !fieldOnlyKeys.has(normalizeKey(name)) && isSensitiveKey(name);
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The last segment of Vercel's `x-vercel-id`, which is also Ramble's request ID on the platform.
const platformIdTail = /^[a-z0-9]{3,8}-\d{13}-[a-f0-9]{12}$/;

// A route pattern such as `/manage/[token]` names a parameter, it does not hold one.
const routePlaceholder = /^\[\.{0,3}[A-Za-z0-9_-]{1,40}\]$/;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

// Every quantifier that can be followed by something that fails is bounded, because backtracking
// over an unbounded run is quadratic on a long string. An unbounded quantifier appears only as the
// last element of a pattern, where a match consumes it once and a miss costs nothing.
const urlCredentials = /\b([a-z][a-z0-9+.-]{1,20}:\/\/)[^\s/@]{1,200}@/gi;
const jwt =
  /\beyJ[A-Za-z0-9_-]{5,2000}\.[A-Za-z0-9_-]{5,2000}\.[A-Za-z0-9_-]{0,2000}/g;
const authScheme = /\b(Bearer|Basic|Digest)\s{1,10}[A-Za-z0-9._~+/=-]{8,}/gi;
const providerKey =
  /\b(?:(?:sk|pk|rk|whsec)_(?:live_|test_)?[A-Za-z0-9]{8,}|xa(?:at|pt|ip)-[0-9a-f-]{20,}|sntry[su]_[A-Za-z0-9+/=_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/g;
const cookieHeader = /\b(set-cookie|cookie)(\s{0,3}:\s{0,3})[^\n]*/gi;
const queryParam = /([?&;])([A-Za-z0-9_.[\]-]{1,64})=([^&\s#"'<>]*)/g;
const keyValue =
  /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]{1,64})(["']?\s{0,3}[=:]\s{0,3})(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&"'<>]+(?: \[redacted\])?)/g;
// Manage, gift, and order links carry their capability in the path (design doc 4.2.3).
const capabilityPath = /(\/(?:manage|gift|orders?)\/)([^/?#\s"'<>]+)/gi;
const email =
  /[A-Za-z0-9._%+-]{1,64}(?:@|%40)[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g;
const cardCandidate = /(?<!\d)\d(?:[ ./-]?\d){12,18}(?!\d)/g;
const opaqueRun = /[A-Za-z0-9_-]{32,}/g;
// Node quotes the start of the text it could not parse: `Unexpected token 'h', "hunter2" is not valid JSON`.
const jsonSnippet =
  /(Unexpected token [^\n]{1,12}?, )"[^\n]{0,1000}"(?:\.\.\.)?( is not valid JSON)/g;

const shortSensitiveParams = new Set(['t', 'k', 'sig', 'code', 'key', 'auth']);

function redactQueryParam(
  match: string,
  separator: string,
  name: string,
): string {
  const sensitive =
    isSensitiveTextName(name) || shortSensitiveParams.has(name.toLowerCase());
  return sensitive ? `${separator}${name}=${REDACTED}` : match;
}

function redactKeyValue(
  match: string,
  name: string,
  separator: string,
): string {
  return isSensitiveTextName(name) ? `${name}${separator}${REDACTED}` : match;
}

function redactCapabilityPath(
  match: string,
  prefix: string,
  segment: string,
): string {
  return routePlaceholder.test(segment) ? match : `${prefix}${REDACTED}`;
}

function redactOpaqueRun(run: string): string {
  if (uuidPattern.test(run) || platformIdTail.test(run)) return run;
  // Slugs and identifiers are lowercase words; a secret of this length has a digit or capital.
  if (!/[0-9A-Z]/.test(run)) return run;
  return '[redacted:token]';
}

function isCardNumber(digits: string, minLength: number): boolean {
  return digits.length >= minLength && digits.length <= 19 && luhnValid(digits);
}

function redactCard(candidate: string): string {
  return isCardNumber(candidate.replace(/\D/g, ''), 13)
    ? '[redacted:card]'
    : candidate;
}

// A database error message ends with the bound values: Drizzle's reads
// "Failed query: <sql>\nparams: <values>". Everything from there on is dropped.
function cutQueryParams(input: string): string {
  const at = input.indexOf('\nparams:');
  return at === -1 ? input : `${input.slice(0, at)}\nparams: ${REDACTED}`;
}

/** Applies every value rule to `input`. The result is not length-limited; see {@link redactString}. */
function scrub(input: string): string {
  return cutQueryParams(input)
    .replace(jsonSnippet, `$1${REDACTED}$2`)
    .replace(urlCredentials, '$1[redacted]@')
    .replace(jwt, '[redacted:jwt]')
    .replace(authScheme, '$1 [redacted]')
    .replace(providerKey, '[redacted:key]')
    .replace(cookieHeader, `$1$2${REDACTED}`)
    .replace(queryParam, redactQueryParam)
    .replace(keyValue, redactKeyValue)
    .replace(capabilityPath, redactCapabilityPath)
    .replace(email, '[redacted:email]')
    .replace(cardCandidate, redactCard)
    .replace(opaqueRun, redactOpaqueRun);
}

const tokenCharacter = /[A-Za-z0-9_.+/=-]/;

function dropPartialToken(text: string): string {
  let end = text.length;
  const floor = Math.max(0, end - maxPartialToken);
  while (end > floor && tokenCharacter.test(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/**
 * Redacts one string and cuts it to `maxLength`. Only the first `scanFactor` times `maxLength`
 * characters are scanned, so the patterns' cost is bounded by what the caller keeps; the
 * unfinished token at that cut is dropped, and the cut is marked.
 */
export function redactString(
  input: string,
  maxLength: number = defaultLimits.maxStringLength,
): string {
  const scanLimit = Math.max(maxLength, 1) * scanFactor;
  const cut = input.length > scanLimit;
  const text = cut ? dropPartialToken(input.slice(0, scanLimit)) : input;
  const scrubbed = scrub(text);
  if (scrubbed.length > maxLength) {
    return `${scrubbed.slice(0, maxLength)}${TRUNCATED}`;
  }
  return cut ? `${scrubbed}${TRUNCATED}` : scrubbed;
}

type Walk = {
  limits: RedactLimits;
  nodes: number;
  chars: number;
  ancestors: WeakSet<object>;
};

function spendNode(walk: Walk): boolean {
  walk.nodes += 1;
  return walk.nodes <= walk.limits.maxNodes;
}

function spendString(walk: Walk, input: string): string {
  if (walk.chars >= walk.limits.maxTotalChars) return TRUNCATED;
  const room = walk.limits.maxTotalChars - walk.chars;
  const text = redactString(input, Math.min(walk.limits.maxStringLength, room));
  walk.chars += text.length;
  return text;
}

function safeRead(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    // A getter or proxy on a logged object must never turn a log call into a crash.
    return UNREDACTABLE;
  }
}

function walkError(error: Error, walk: Walk, depth: number): unknown {
  const field = (name: string) =>
    safeRead(() => (error as unknown as Record<string, unknown>)[name]);
  const text = (value: unknown) =>
    typeof value === 'string'
      ? spendString(walk, value)
      : walkValue(value, walk, depth + 1);

  const out: [string, unknown][] = [
    ['name', text(field('name'))],
    ['message', text(field('message'))],
  ];
  const stack = field('stack');
  if (typeof stack === 'string') {
    out.push(['stack', spendString(walk, stack.slice(0, maxStackLength))]);
  }
  const code = field('code');
  if (typeof code === 'string' || typeof code === 'number') {
    out.push(['code', text(code)]);
  }
  const cause = field('cause');
  if (cause !== undefined) {
    out.push(['cause', walkValue(cause, walk, depth + 1)]);
  }
  if (error instanceof AggregateError) {
    out.push(['errors', walkValue(field('errors'), walk, depth + 1)]);
  }
  return Object.fromEntries(out);
}

function walkEntries(
  entries: [string, unknown][],
  walk: Walk,
  depth: number,
  total = entries.length,
): unknown {
  const kept = entries.slice(0, walk.limits.maxKeys);
  const out: [string, unknown][] = [];
  for (const [rawKey, value] of kept) {
    if (!spendNode(walk)) {
      out.push([TRUNCATED, 'node budget spent']);
      break;
    }
    const key = redactString(rawKey, maxKeyLength);
    out.push([
      key,
      isSensitiveKey(rawKey) ? REDACTED : walkValue(value, walk, depth + 1),
    ]);
  }
  if (total > kept.length) {
    out.push([TRUNCATED, `${String(total - kept.length)} more keys`]);
  }
  return Object.fromEntries(out);
}

function walkArray(value: unknown[], walk: Walk, depth: number): unknown[] {
  const length = safeRead(() => value.length);
  const total = typeof length === 'number' ? length : 0;
  const out: unknown[] = [];
  for (
    let index = 0;
    index < Math.min(total, walk.limits.maxArrayItems);
    index += 1
  ) {
    if (!spendNode(walk)) {
      out.push(TRUNCATED);
      break;
    }
    out.push(
      walkValue(
        safeRead(() => value[index]),
        walk,
        depth + 1,
      ),
    );
  }
  if (total > walk.limits.maxArrayItems) {
    out.push(
      `${TRUNCATED} ${String(total - walk.limits.maxArrayItems)} more items`,
    );
  }
  return out;
}

function walkObject(value: object, walk: Walk, depth: number): unknown {
  if (Array.isArray(value)) return walkArray(value, walk, depth);
  if (value instanceof Error) return walkError(value, walk, depth);
  // Boxed primitives are unwrapped so they meet the same rules as the primitive.
  if (
    value instanceof String ||
    value instanceof Number ||
    value instanceof Boolean ||
    value instanceof BigInt
  ) {
    return walkValue(value.valueOf(), walk, depth);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof URL) return spendString(walk, value.href);
  if (value instanceof Map) return `[Map of ${String(value.size)}]`;
  if (value instanceof Set) return `[Set of ${String(value.size)}]`;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return `[Binary of ${String(value.byteLength)} bytes]`;
  }
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    return walkEntries([...value.entries()], walk, depth);
  }
  if (
    typeof URLSearchParams !== 'undefined' &&
    value instanceof URLSearchParams
  ) {
    return walkEntries([...value.entries()], walk, depth);
  }
  const keys = Object.keys(value);
  return walkEntries(
    keys
      .slice(0, walk.limits.maxKeys)
      .map((key): [string, unknown] => [
        key,
        safeRead(() => (value as Record<string, unknown>)[key]),
      ]),
    walk,
    depth,
    keys.length,
  );
}

// A card number held as a number or bigint; 13-digit values are mostly millisecond timestamps.
function looksLikeCardInteger(value: number | bigint): boolean {
  return isCardNumber(String(value < 0 ? -value : value), 15);
}

function walkValue(value: unknown, walk: Walk, depth: number): unknown {
  switch (typeof value) {
    case 'string':
      return spendString(walk, value);
    case 'number':
      if (!Number.isFinite(value)) return String(value);
      return Number.isSafeInteger(value) && looksLikeCardInteger(value)
        ? '[redacted:card]'
        : value;
    case 'boolean':
      return value;
    case 'bigint':
      return looksLikeCardInteger(value) ? '[redacted:card]' : value.toString();
    case 'undefined':
      return undefined;
    case 'symbol':
      return '[Symbol]';
    case 'function':
      return '[Function]';
    case 'object':
      break;
  }
  if (value === null) return null;
  if (depth >= walk.limits.maxDepth) return TRUNCATED;
  if (walk.ancestors.has(value)) return '[Circular]';
  walk.ancestors.add(value);
  try {
    return walkObject(value, walk, depth);
  } catch {
    // A revoked proxy or a hostile getter: the value is dropped, the call carries on.
    return UNREDACTABLE;
  } finally {
    walk.ancestors.delete(value);
  }
}

/**
 * Returns a JSON-safe copy of `value` with every redaction rule applied and every bound enforced.
 * The input is never mutated and the call never throws: a value that cannot be read, such as a
 * revoked proxy or a getter that throws, is replaced by `'[unredactable]'`.
 */
export function redact(
  value: unknown,
  limits: Partial<RedactLimits> = {},
): unknown {
  try {
    return walkValue(
      value,
      {
        limits: { ...defaultLimits, ...limits },
        nodes: 0,
        chars: 0,
        ancestors: new WeakSet(),
      },
      0,
    );
  } catch {
    return UNREDACTABLE;
  }
}
