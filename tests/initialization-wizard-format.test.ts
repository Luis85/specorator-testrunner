import { describe, expect, it } from "vitest";
import { failureOutputTail } from "../src/presentation/views/initialization-wizard-format";
import { appError } from "../src/shared/errors/errors";

describe("failureOutputTail (wizard failure box)", () => {
  it("returns null for errors without process stderr", () => {
    expect(failureOutputTail(appError("INIT_FAILED", "boom"))).toBeNull();
    expect(
      failureOutputTail(appError("INIT_FAILED", "boom", { details: { exitCode: 1 } })),
    ).toBeNull();
    expect(
      failureOutputTail(appError("INIT_FAILED", "boom", { details: { stderr: "  \r\n " } })),
    ).toBeNull();
  });

  it("normalizes Windows CRLF and trims blank edge lines (testvault npm failure shape)", () => {
    const stderr =
      "\r\nError: Cannot find module 'C:\\\\vault\\\\.testrunner\\\\node_modules\\\\npm\\\\bin\\\\npm-prefix.js'\r\n    at Module._resolveFilename\r\n\r\nNode.js v24.15.0\r\n";
    const tail = failureOutputTail(
      appError("NPM_INSTALL_FAILED", "dependency installation failed (exit 1).", {
        details: { exitCode: 1, stderr },
      }),
    );
    expect(tail).toBe(
      "Error: Cannot find module 'C:\\\\vault\\\\.testrunner\\\\node_modules\\\\npm\\\\bin\\\\npm-prefix.js'\n    at Module._resolveFilename\n\nNode.js v24.15.0",
    );
  });

  it("keeps only the LAST 30 lines, marking the truncation", () => {
    const stderr = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
    const tail = failureOutputTail(appError("NPM_INSTALL_FAILED", "fail", { details: { stderr } }));
    expect(tail?.startsWith("…\nline 11")).toBe(true);
    expect(tail?.endsWith("line 40")).toBe(true);
  });
});
