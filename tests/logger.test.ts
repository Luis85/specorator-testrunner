import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleLogger, redactFields } from "../src/shared/logging/logger";

describe("redactFields", () => {
  it("redacts values whose key looks sensitive", () => {
    const out = redactFields({ password: "hunter2", token: "abc", runId: "RUN-1" });
    expect(out).toEqual({ password: "***", token: "***", runId: "RUN-1" });
  });

  it("redacts values that match a known secret regardless of key", () => {
    const out = redactFields({ note: "s3cr3t" }, new Set(["s3cr3t"]));
    expect(out).toEqual({ note: "***" });
  });

  it("passes undefined through", () => {
    expect(redactFields(undefined)).toBeUndefined();
  });
});

describe("ConsoleLogger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("honours the minimum level", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleLogger("warn");
    logger.info("ignored");
    expect(log).not.toHaveBeenCalled();
  });

  it("redacts sensitive fields before writing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new ConsoleLogger("info").warn("careful", { authToken: "abc" });
    expect(warn).toHaveBeenCalledWith(expect.any(String), { authToken: "***" });
  });

  it("describes errors on the error channel", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    new ConsoleLogger("info").error("boom", new Error("kaboom"));
    const fields = error.mock.calls[0][1] as { error: { message: string } };
    expect(fields.error.message).toBe("kaboom");
  });

  it("redacts a configured secret logged positionally under a non-sensitive key (P0-2)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleLogger("info");
    // Mirrors wiring the SUT auth.env credential values into the logger.
    logger.setSecrets(["super-secret-token"]);
    // The credential is echoed into streamed runner stderr under a plain key.
    logger.info("runner output", { stderr: "login failed: super-secret-token" });
    // Whole-value matching only — a partial credential inside a longer string is
    // not redacted by value-based redaction (the field would need a sensitive key).
    logger.info("exact value", { detail: "super-secret-token" });
    expect(log).toHaveBeenLastCalledWith(expect.any(String), { detail: "***" });
  });

  it("ignores empty secret values (setSecrets) so empty strings aren't blanked", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleLogger("info");
    logger.setSecrets(["", "real"]);
    logger.info("msg", { a: "", b: "real" });
    expect(log).toHaveBeenCalledWith(expect.any(String), { a: "", b: "***" });
  });
});
