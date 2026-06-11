import { redactSecrets } from "./redact";
import type { AppError } from "../errors/errors";

/**
 * Structured diagnostics with credential redaction (TIS §13.3, ADR-0019).
 *
 * Redaction is enforced inside the Logger; call sites cannot bypass it without
 * dropping to raw `console.*`.
 */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, error?: Error | AppError, fields?: Record<string, unknown>): void;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY = /pass|secret|token|key|auth|credential/i;
const REDACTED = "***";

/**
 * Replaces values whose key looks sensitive, or that match a known secret. The
 * value-based scrubbing shares {@link redactSecrets} with the live console
 * stream so both enforce identical ADR-0019 semantics. Recurses into plain
 * objects and arrays so a secret nested in `Error.message`/`stack` or
 * `AppError.details` (the `error` field built by {@link ConsoleLogger.error})
 * cannot bypass the scrub.
 */
export const redactFields = (
  fields: Record<string, unknown> | undefined,
  secrets: ReadonlySet<string> = new Set(),
  seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> | undefined => {
  if (!fields) return fields;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = redactValue(value, secrets, seen);
    }
  }
  return out;
};

const redactValue = (
  value: unknown,
  secrets: ReadonlySet<string>,
  seen: WeakSet<object>,
): unknown => {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (value === null || typeof value !== "object") return value;
  // A circular graph must not recurse forever — the logger crashing inside an
  // error-handling path would be worse than the redaction it provides.
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  // An Error nested in fields (e.g. an AppError's details.cause) carries the
  // leak surface in message/stack; flatten it so the scrub reaches them.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSecrets(value.message, secrets),
      stack: value.stack === undefined ? undefined : redactSecrets(value.stack, secrets),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets, seen));
  // Plain records only (incl. Object.create(null)); class instances (Map,
  // TFile, …) are passed through — stringifying them here would lose more
  // diagnostics than it protects, and call sites don't log credentials there.
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    return redactFields(value as Record<string, unknown>, secrets, seen);
  }
  return value;
};

/**
 * Console-backed Logger. The persistent vault file sink (ADR-0019) is wired in
 * a later sprint via `LogSinkPort`; this keeps console/Notice diagnostics
 * available from sprint one.
 */
export class ConsoleLogger implements Logger {
  private secrets: ReadonlySet<string>;
  private minLevel: LogLevel;

  constructor(
    minLevel: LogLevel = "info",
    secrets: ReadonlySet<string> = new Set(),
    private readonly prefix = "[e2e-test-hub]",
  ) {
    this.minLevel = minLevel;
    this.secrets = secrets;
  }

  /**
   * Adjusts the level filter in place. Exists so the composition root can keep
   * ONE logger instance for every service — rebuilding the logger after
   * settings load would strand earlier-constructed services on a stale
   * instance that never receives {@link setSecrets} refreshes (F3).
   */
  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Refreshes the value-based redaction set (ADR-0019). Call on settings change
   * so newly-configured `auth.env` credentials are scrubbed without rebuilding
   * the logger (P0-2 / T3). Empty values are ignored — redacting "" would blank
   * every empty string in the logs.
   */
  setSecrets(secrets: Iterable<string>): void {
    this.secrets = new Set([...secrets].filter((s) => s.length > 0));
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.emit("debug", msg, fields);
  }

  info(msg: string, fields?: Record<string, unknown>): void {
    this.emit("info", msg, fields);
  }

  warn(msg: string, fields?: Record<string, unknown>): void {
    this.emit("warn", msg, fields);
  }

  error(msg: string, error?: Error | AppError, fields?: Record<string, unknown>): void {
    this.emit("error", msg, error ? { ...fields, error: this.describeError(error) } : fields);
  }

  private describeError(error?: Error | AppError): unknown {
    if (!error) return undefined;
    if (error instanceof Error) return { message: error.message, stack: error.stack };
    return { code: error.code, message: error.message, details: error.details };
  }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const redacted = redactFields(fields, this.secrets);
    // The message is scrubbed too — call sites interpolate config values
    // (e.g. a baseUrl that can embed `user:pass@host`) into message text.
    const line = `${this.prefix} ${redactSecrets(msg, this.secrets)}`;
    // The console IS this logger's sink (ADR-0019): level-gated, redacted,
    // prefixed — not the "unnecessary logging" the guideline targets.
    // eslint-disable-next-line obsidianmd/rule-custom-message
    const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    if (redacted && Object.keys(redacted).length > 0) sink(line, redacted);
    else sink(line);
  }
}
