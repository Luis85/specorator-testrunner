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

/** Replaces values whose key looks sensitive, or that match a known secret. */
export const redactFields = (
  fields: Record<string, unknown> | undefined,
  secrets: ReadonlySet<string> = new Set(),
): Record<string, unknown> | undefined => {
  if (!fields) return fields;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = REDACTED;
    } else if (typeof value === "string" && secrets.has(value)) {
      out[key] = REDACTED;
    } else {
      out[key] = value;
    }
  }
  return out;
};

/**
 * Console-backed Logger. The persistent vault file sink (ADR-0019) is wired in
 * a later sprint via `LogSinkPort`; this keeps console/Notice diagnostics
 * available from sprint one.
 */
export class ConsoleLogger implements Logger {
  private secrets: ReadonlySet<string>;

  constructor(
    private readonly minLevel: LogLevel = "info",
    secrets: ReadonlySet<string> = new Set(),
    private readonly prefix = "[e2e-test-hub]",
  ) {
    this.secrets = secrets;
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

  error(
    msg: string,
    error?: Error | AppError,
    fields?: Record<string, unknown>,
  ): void {
    this.emit("error", msg, { ...fields, error: this.describeError(error) });
  }

  private describeError(error?: Error | AppError): unknown {
    if (!error) return undefined;
    if (error instanceof Error) return { message: error.message, stack: error.stack };
    return { code: error.code, message: error.message, details: error.details };
  }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const redacted = redactFields(fields, this.secrets);
    const line = `${this.prefix} ${msg}`;
    const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    if (redacted && Object.keys(redacted).length > 0) sink(line, redacted);
    else sink(line);
  }
}
