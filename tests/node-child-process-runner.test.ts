import { describe, expect, it } from "vitest";
import type { RunnerOutput } from "../src/application/ports/child-process-runner";
import { NodeChildProcessRunner } from "../src/infrastructure/runner/node-child-process-runner";

/**
 * Integration-style unit tests for the security-critical process boundary
 * (BBV §7 `ProcessAdapter`, P4-1 / TEST-H1). These exercise the REAL adapter by
 * spawning short-lived `node -e "…"` children via the system Node, so the
 * `shell: false` argv pass-through, line streaming, exit mapping, and id-keyed
 * cancellation are verified against actual `child_process.spawn` behaviour
 * rather than a fake.
 *
 * The `.cmd` shim path and the cmd `%`-rejection are Windows-only (the source
 * gates them on `process.platform === "win32"`); CI runs on ubuntu, so those
 * assertions are guarded behind a platform check and otherwise skipped.
 */

const NODE = process.execPath;

describe("NodeChildProcessRunner (real spawn, POSIX)", () => {
  it("passes argv through verbatim with shell:false (no word-split / expansion)", async () => {
    const runner = new NodeChildProcessRunner();
    // A single literal arg containing spaces, $, and & must reach the child as
    // ONE argument, unexpanded and un-word-split. The child echoes process.argv
    // back so we can read exactly what it received.
    const literal = "a b $HOME && echo pwned";
    const result = await runner.run({
      args: [NODE, "-e", "process.stdout.write(process.argv[1])", literal],
      cwd: process.cwd(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // process.argv[1] is the first arg after the `-e` script (argv[0] is node,
    // the script body is consumed by -e). The literal arrives byte-for-byte.
    expect(result.value.stdout).toBe(literal);
    expect(result.value.exitCode).toBe(0);
  });

  it("streams complete stdout AND stderr lines, buffering partial lines across chunks", async () => {
    const runner = new NodeChildProcessRunner();
    const outputs: RunnerOutput[] = [];
    // Write a partial line first (no newline), then complete it on a second
    // write, then a stderr line. The adapter must hold the partial until the
    // newline arrives and never emit a half-line, and must flush the final
    // newline-terminated lines on close.
    const script = [
      "process.stdout.write('hel');",
      "process.stdout.write('lo\\nsecond\\n');",
      "process.stderr.write('err-line\\n');",
    ].join("");
    const result = await runner.runStreaming(
      { args: [NODE, "-e", script], cwd: process.cwd() },
      (output) => outputs.push(output),
    );

    expect(result.ok).toBe(true);
    const stdoutLines = outputs.filter((o) => o.stream === "stdout").map((o) => o.line);
    const stderrLines = outputs.filter((o) => o.stream === "stderr").map((o) => o.line);
    // "hel" + "lo" must arrive as the single line "hello", not as two fragments.
    expect(stdoutLines).toEqual(["hello", "second"]);
    expect(stderrLines).toEqual(["err-line"]);
    // Every streamed line carries an ISO timestamp.
    for (const o of outputs) expect(() => new Date(o.timestamp).toISOString()).not.toThrow();
  });

  it("maps a non-zero exit code to RunnerCommandResult.exitCode", async () => {
    const runner = new NodeChildProcessRunner();
    const result = await runner.run({
      args: [NODE, "-e", "process.exit(3)"],
      cwd: process.cwd(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exitCode).toBe(3);
  });

  it("cancel(id) kills ONLY the child registered under that processId", async () => {
    const runner = new NodeChildProcessRunner();
    // A child that would otherwise run ~30s. cancel() must terminate it; the
    // process should close with a non-zero/null exit well before the timeout.
    const longScript = "setTimeout(() => {}, 30000)";
    const pending = runner.runStreaming(
      { args: [NODE, "-e", longScript], cwd: process.cwd(), processId: "run-A" },
      () => {},
    );
    // Give spawn a tick to register the child under "run-A".
    await new Promise((r) => setTimeout(r, 200));

    const cancelled = await runner.cancel("run-A");
    expect(cancelled.ok).toBe(true);

    const result = await pending;
    // SIGTERM closes the process: exit code is non-zero (or -1 / signal),
    // never the 0 a 30s sleep that ran to completion would produce.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exitCode).not.toBe(0);
  }, 15000);

  it("cancel(unknown-id) is a safe no-op and does NOT kill a running child", async () => {
    const runner = new NodeChildProcessRunner();
    // A short child that exits 0 on its own after ~600ms.
    const pending = runner.run({
      args: [NODE, "-e", "setTimeout(() => process.exit(0), 600)"],
      cwd: process.cwd(),
      processId: "run-B",
    });
    await new Promise((r) => setTimeout(r, 150));

    // Cancelling a DIFFERENT id must not touch run-B (P0-4 fix: the adapter keys
    // its active map by request.processId).
    const cancelled = await runner.cancel("does-not-exist");
    expect(cancelled.ok).toBe(true);

    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // It ran to its own clean exit — the no-op cancel did not kill it.
    expect(result.value.exitCode).toBe(0);
  }, 15000);

  it("returns INIT_FAILED when the program does not exist", async () => {
    const runner = new NodeChildProcessRunner();
    const result = await runner.run({
      args: ["this-program-does-not-exist-xyz", "--version"],
      cwd: process.cwd(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INIT_FAILED");
  });

  it("rejects a cmd `%` argument on Windows only (platform-gated source path)", async () => {
    if (process.platform !== "win32") {
      // The %-rejection is Windows-only in the adapter (POSIX passes % literally),
      // and CI runs on ubuntu — nothing to assert here.
      expect(process.platform).not.toBe("win32");
      return;
    }
    const runner = new NodeChildProcessRunner();
    const result = await runner.run({
      args: ["npm", "run", "%PATH%"],
      cwd: process.cwd(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COMMAND_DISALLOWED");
  });
});
