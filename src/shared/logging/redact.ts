/**
 * Shared credential-redaction primitive (ADR-0019). One implementation backs
 * both the {@link ConsoleLogger} (persisted diagnostics) and the live Test
 * Console stream (`testrun.output.received`), so redaction semantics cannot
 * diverge between them.
 */

const REDACTED = "***";

/**
 * Minimum length for a secret to be scrubbed as a SUBSTRING of a larger value.
 * Short values (e.g. a credential that happens to be `true`/`node`) are matched
 * only as whole values — substring-scrubbing them would mangle unrelated
 * diagnostics. Real credentials/tokens are high-entropy and well past this
 * (security review M1/M3).
 */
export const MIN_SUBSTRING_SECRET_LEN = 8;

/**
 * Scrubs whole-value and (for long, high-entropy values) embedded secrets.
 *
 * - A value that EXACTLY equals a known secret (any length) becomes `***`.
 * - A secret of at least {@link MIN_SUBSTRING_SECRET_LEN} chars is also scrubbed
 *   when it appears as a SUBSTRING of a larger value (e.g. a credential echoed
 *   inside a runner `stderr` line), so it can't leak into logs or the console.
 *
 * Short secrets are deliberately NOT substring-scrubbed to avoid mangling
 * unrelated text. An empty secret set short-circuits with no allocation so the
 * hot streaming path stays cheap.
 */
export const redactSecrets = (text: string, secrets: ReadonlySet<string>): string => {
  if (secrets.size === 0) return text;
  if (secrets.has(text)) return REDACTED;
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= MIN_SUBSTRING_SECRET_LEN && out.includes(secret)) {
      out = out.split(secret).join(REDACTED);
    }
  }
  return out;
};
