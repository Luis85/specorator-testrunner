import type { AppError } from "../errors/errors";

/**
 * Exception-free flow for application-level operations (TIS §3.1, BBV §8).
 *
 * Application services return `Result<T, E>` instead of throwing; exceptions
 * are reserved for programmer errors.
 */
export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
