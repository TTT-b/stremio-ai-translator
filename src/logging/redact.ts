const SENSITIVE_KEY = /(api[-_]?key|token|password|passwd|secret|authorization|cookie)/i;
const MASK = '[REDACTED]';

/**
 * Builds a function that removes secrets from any value before it is logged:
 * - object keys that look sensitive are masked
 * - strings containing a known secret value, an AIza-style key, or a Bearer token are scrubbed
 */
export function createRedactor(secrets: () => string[]) {
  function scrubString(input: string): string {
    let out = input;
    for (const s of secrets()) {
      if (s && out.includes(s)) out = out.split(s).join(MASK);
    }
    out = out.replace(/AIza[0-9A-Za-z_-]{20,}/g, MASK);
    out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MASK}`);
    out = out.replace(/([?&](?:key|api_key|apikey|token)=)[^&\s]+/gi, `$1${MASK}`);
    return out;
  }

  function scrub(value: unknown, depth = 0): unknown {
    if (typeof value === 'string') return scrubString(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth > 6) return '[Truncated]';
    if (value instanceof Error) {
      return { name: value.name, message: scrubString(value.message) };
    }
    if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) && v ? MASK : scrub(v, depth + 1);
    }
    return out;
  }

  return { scrub, scrubString };
}
