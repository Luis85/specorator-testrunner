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
});
