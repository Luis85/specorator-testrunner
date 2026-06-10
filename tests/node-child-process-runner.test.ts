import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { RunnerOutput } from "../src/application/ports/child-process-runner";
import {
  buildCmdShimCommandLine,
  NodeChildProcessRunner,
  type SpawnFn,
} from "../src/infrastructure/runner/node-child-process-runner";

/**
 * Integration-style unit tests for the security-critical process boundary
 * (BBV §7 `ProcessAdapter`, P4-1 / TEST-H1). These exercise the REAL adapter by
 * spawning short-lived `node -e "…"` children via the system Node, so the
 * `shell: false` argv pass-through, line streaming, exit mapping, and id-keyed
 * cancellation are verified against actual `child_process.spawn` behaviour
 * rather than a fake.
 *
 * The `.cmd` shim path and the cmd `%`-rejection are Windows-only in the source.
 * Rather than leave them to a Windows-only CI leg, the runner takes an
 * INJECTABLE platform (default `process.platform`) plus a `spawn` seam, so the
 * win32 composition is exercised deterministically here ON LINUX — see the
 * "win32 cmd-shim path (injected platform)" block below.
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

  it("passes a literal `%` arg through verbatim on POSIX (no Windows expansion)", async () => {
    // The cmd `%`-rejection is win32-only; on POSIX `%` is an ordinary character
    // and must reach the child untouched (this run uses the REAL spawn).
    const runner = new NodeChildProcessRunner();
    const result = await runner.run({
      args: [NODE, "-e", "process.stdout.write(process.argv[1])", "%PATH%"],
      cwd: process.cwd(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stdout).toBe("%PATH%");
  });
});

/**
 * Builds a minimal fake `child_process.spawn` (a recording seam): every call is
 * captured and the returned object is just enough of a ChildProcess for the
 * runner to attach listeners and resolve on `close`. NO real process launches,
 * so the win32 cmd composition can be asserted on any OS.
 */
const fakeSpawn = () => {
  const calls: { command: string; args: readonly string[]; options: unknown }[] = [];
  const spawnFn = ((command: string, args: readonly string[], options: unknown) => {
    calls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & {
      stdout: null;
      stderr: null;
      pid: number;
    };
    child.stdout = null;
    child.stderr = null;
    child.pid = 4242;
    // Resolve the run on the next tick by signalling a clean exit.
    queueMicrotask(() => child.emit("close", 0));
    return child;
  }) as unknown as SpawnFn;
  return { spawnFn, calls };
};

describe("buildCmdShimCommandLine (pure cmd /s /c composition)", () => {
  it("leaves a bare program name UNQUOTED and quotes every argument", () => {
    // REGRESSION (testvault install failure): a QUOTED bare name ("npm")
    // keeps %0 as the literal `"npm"`, so %~dp0 inside npm.cmd resolves
    // against the CWD — npm dies with `Cannot find module
    // '<cwd>\\node_modules\\npm\\bin\\npm-prefix.js'` (exit 1). Unquoted, cmd
    // resolves via PATH and rewrites %0 to the full script path.
    expect(buildCmdShimCommandLine(["npm", "run", "test"])).toBe('"npm "run" "test""');
    expect(buildCmdShimCommandLine(["npm", "install"])).toBe('"npm "install""');
  });

  it("quotes a program PATH that needs it (spaces) — %0 then carries the directory", () => {
    expect(buildCmdShimCommandLine(["C:\\node js\\npm.cmd", "install"])).toBe(
      '""C:\\node js\\npm.cmd" "install""',
    );
  });

  it("keeps spaces and cmd metacharacters literal inside the argument quotes", () => {
    expect(buildCmdShimCommandLine(["npm", "run", "test -- --tags @a and @b"])).toBe(
      '"npm "run" "test -- --tags @a and @b""',
    );
  });
});

describe("NodeChildProcessRunner (win32 cmd-shim path, injected platform)", () => {
  it("rejects a `%` argument with COMMAND_DISALLOWED without spawning", async () => {
    const { spawnFn, calls } = fakeSpawn();
    const runner = new NodeChildProcessRunner("win32", spawnFn);
    const result = await runner.run({ args: ["npm", "run", "%PATH%"], cwd: "C:\\work" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COMMAND_DISALLOWED");
    // The `%` is rejected BEFORE any spawn — cmd never sees it.
    expect(calls).toHaveLength(0);
  });

  it("invokes cmd.exe /d /s /c with the quoted, outer-wrapped command line", async () => {
    const { spawnFn, calls } = fakeSpawn();
    const runner = new NodeChildProcessRunner("win32", spawnFn);
    const result = await runner.run({
      args: ["npm", "run", "test", "--", "--tags", "@smoke and not @wip"],
      cwd: "C:\\work",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    // cmd.exe (or %ComSpec%) launched with the documented /d /s /c flags…
    expect(call.command).toMatch(/cmd(\.exe)?$/i);
    expect(call.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    // …and the final arg is the pure builder's output: bare program unquoted
    // (npm.cmd %~dp0), each ARGUMENT quoted, one outer wrapping quote pair.
    expect(call.args[3]).toBe(
      buildCmdShimCommandLine(["npm", "run", "test", "--", "--tags", "@smoke and not @wip"]),
    );
    expect(call.args[3]).toBe('"npm "run" "test" "--" "--tags" "@smoke and not @wip""');
    // Verbatim args so Node doesn't re-quote our hand-built command line.
    expect((call.options as { windowsVerbatimArguments?: boolean }).windowsVerbatimArguments).toBe(
      true,
    );
  });

  it("spawns a non-shim program (e.g. node.exe) DIRECTLY, not via cmd", async () => {
    const { spawnFn, calls } = fakeSpawn();
    const runner = new NodeChildProcessRunner("win32", spawnFn);
    // A configured `node.exe` is not an npm/npx .cmd shim, so it bypasses the cmd
    // wrapper even on win32 — and a literal `%` is therefore allowed here.
    const result = await runner.run({
      args: ["C:\\Program Files\\nodejs\\node.exe", "-v", "%KEEP%"],
      cwd: "C:\\work",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(calls[0].args).toEqual(["-v", "%KEEP%"]);
  });
});

// Runs ONLY on the windows-latest CI leg: a REAL cmd.exe + npm.cmd through the
// composed shim line. This is the test that would have caught the testvault
// install failure — a QUOTED bare "npm" broke %~dp0 inside npm.cmd, which then
// looked for npm-prefix.js/npm-cli.js under the CWD and exited 1. The win32
// unit tests above use a fake spawn, so only a real spawn proves the shim
// composition against the actual cmd quoting rules.
describe.skipIf(process.platform !== "win32")(
  "NodeChildProcessRunner (real spawn, Windows cmd shim)",
  () => {
    it("runs npm --version via the cmd shim from a cwd that has no npm", async () => {
      const runner = new NodeChildProcessRunner();
      // A cwd WITHOUT node_modules/npm: with the broken quoting, npm.cmd's
      // %~dp0 pointed here and npm died with MODULE_NOT_FOUND (exit 1).
      const result = await runner.run({ args: ["npm", "--version"], cwd: process.cwd() });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.stderr).not.toContain("npm-prefix.js");
      expect(result.value.exitCode).toBe(0);
      expect(result.value.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    }, 60000);
  },
);
