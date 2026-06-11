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
    logger.info("exact value", { detail: "super-secret-token" });
    expect(log).toHaveBeenCalledWith(expect.any(String), { detail: "***" });
  });

  it("scrubs a long secret embedded inside a larger logged string, e.g. stderr (M1)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleLogger("info");
    logger.setSecrets(["super-secret-token"]);
    // A credential echoed into streamed runner stderr under a plain key is now
    // substring-scrubbed (long secrets only), so it can't leak into persisted logs.
    logger.info("runner output", { stderr: "login failed: super-secret-token (401)" });
    expect(log).toHaveBeenCalledWith(expect.any(String), { stderr: "login failed: *** (401)" });
  });

  it("does NOT substring-scrub short secrets (avoids over-redaction, M3)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleLogger("info");
    logger.setSecrets(["node"]); // short value — whole-match only
    logger.info("diag", { msg: "running node v20" });
    // "node" is < 8 chars, so it is not scrubbed as a substring of a larger string.
    expect(log).toHaveBeenCalledWith(expect.any(String), { msg: "running node v20" });
  });

  it("ignores empty secret values (setSecrets) so empty strings aren't blanked", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleLogger("info");
    logger.setSecrets(["", "real"]);
    logger.info("msg", { a: "", b: "real" });
    expect(log).toHaveBeenCalledWith(expect.any(String), { a: "", b: "***" });
  });

  it("scrubs a secret interpolated into the MESSAGE text (F4)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleLogger("info");
    logger.setSecrets(["super-secret-token"]);
    logger.info("baseUrl https://user:super-secret-token@host failed");
    expect(log).toHaveBeenCalledWith("[e2e-test-hub] baseUrl https://user:***@host failed");
  });

  it("scrubs a secret nested inside the error field's message/stack (F4)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new ConsoleLogger("info");
    logger.setSecrets(["super-secret-token"]);
    logger.error("boom", new Error("auth failed for super-secret-token"));
    const fields = error.mock.calls[0][1] as { error: { message: string } };
    expect(fields.error.message).toBe("auth failed for ***");
  });

  it("adjusts the level filter in place via setMinLevel (F3)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new ConsoleLogger("warn");
    logger.info("filtered");
    expect(log).not.toHaveBeenCalled();
    logger.setMinLevel("debug");
    logger.info("now visible");
    expect(log).toHaveBeenCalledOnce();
  });

  it("omits the error field entirely when error() is called without one", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    new ConsoleLogger("info").error("plain failure");
    expect(error).toHaveBeenCalledWith("[e2e-test-hub] plain failure");
  });
});

describe("redactFields (nested values, F4)", () => {
  it("recurses into plain objects and arrays", () => {
    const out = redactFields(
      { error: { details: { hint: "use super-secret-token" }, parts: ["super-secret-token"] } },
      new Set(["super-secret-token"]),
    );
    expect(out).toEqual({ error: { details: { hint: "use ***" }, parts: ["***"] } });
  });

  it("redacts sensitive KEYS at any depth", () => {
    const out = redactFields({ error: { token: "abc" } });
    expect(out).toEqual({ error: { token: "***" } });
  });
});
