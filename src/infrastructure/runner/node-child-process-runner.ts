import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import type {
  ChildProcessRunner,
  RunCommandRequest,
  RunnerCommandResult,
  RunnerOutput,
} from "../../application/ports/child-process-runner";
import { appError } from "../../shared/errors/errors";
import { ok, type Result } from "../../shared/result/result";

/**
 * Quotes one token for a `cmd.exe /c` command line: wrapped in double quotes
 * (so spaces and the cmd metacharacters `& | < > ^ ( )` stay literal) with any
 * embedded quote doubled per cmd's convention. Used only on Windows, where the
 * `.cmd` shim forces a shell launch.
 */
export const quoteForCmd = (token: string): string => `"${token.replace(/"/g, '""')}"`;

/**
 * Composes the single command-line string passed to `cmd.exe /d /s /c` for the
 * `.cmd` shim path. ARGUMENTS are always quoted via {@link quoteForCmd}; the
 * PROGRAM token is quoted ONLY when it needs it (spaces/quotes — e.g. a full
 * path under `C:\Program Files`). A bare program name must stay UNQUOTED:
 * invoking a batch file as a quoted bare name (`"npm" install`) makes cmd keep
 * `%0` as the literal `"npm"`, so `%~dp0` inside `npm.cmd` resolves against
 * the CURRENT DIRECTORY instead of npm's install dir — npm then dies with
 * `Cannot find module '<cwd>\node_modules\npm\bin\npm-prefix.js'` (exit 1, the
 * v1 testvault install failure). Unquoted, cmd resolves the name via PATH and
 * rewrites `%0` to the full script path, so `%~dp0` is correct; a quoted FULL
 * path is also fine (`%0` carries the directory either way).
 *
 * The joined line is then wrapped in ONE outer quote pair: `cmd /s /c` strips
 * the first and last quote of the command string, so without the wrapper the
 * inner quotes would be mangled (the documented `cmd /s /c "x "y""` form).
 *
 * Pure (no spawning) so the Windows command-line composition is unit-testable on
 * any OS without launching a real `cmd.exe`.
 */
export const buildCmdShimCommandLine = (args: readonly string[]): string => {
  const [program, ...rest] = args;
  const programToken = /[\s"]/.test(program) ? quoteForCmd(program) : program;
  return `"${[programToken, ...rest.map(quoteForCmd)].join(" ")}"`;
};

/** Subset of `child_process.spawn` the runner depends on — injectable as a seam. */
export type SpawnFn = typeof spawn;

/**
 * Node `child_process.spawn`-backed runner (BBV §7 `ProcessAdapter`).
 *
 * Commands are spawned from an argv array with `shell: false` — there is no
 * shell, so feature paths/tags with `$`, `&`, or spaces are passed verbatim as
 * literal arguments and cannot be interpolated or word-split (TIS §13.2; the PR
 * #7 decision to rework the runner to argv arrays). `args[0]` is the program
 * (e.g. "npm"); the remaining entries are its arguments. They come from trusted
 * settings defaults and are screened by `CommandSafetyPolicy` before arriving.
 */
export class NodeChildProcessRunner implements ChildProcessRunner {
  private readonly active = new Map<string, ChildProcess>();
  private counter = 0;

  /**
   * @param platform Which OS path to take. Defaults to the real
   *   `process.platform`, so production behaviour is unchanged; tests inject
   *   `"win32"` to exercise the cmd-shim branch deterministically on Linux.
   * @param spawnFn Seam over `child_process.spawn`. Defaults to the real spawn;
   *   tests inject a fake to assert the composed cmd argv WITHOUT launching a
   *   real Windows process.
   */
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnFn: SpawnFn = spawn,
  ) {}

  run(request: RunCommandRequest): Promise<Result<RunnerCommandResult>> {
    return this.spawn(request);
  }

  runStreaming(
    request: RunCommandRequest,
    onOutput: (output: RunnerOutput) => void,
  ): Promise<Result<RunnerCommandResult>> {
    return this.spawn(request, onOutput);
  }

  async cancel(processId: string): Promise<Result<void>> {
    // Honor the id: kill ONLY the matching child (and its whole process tree),
    // never sibling installs/validations sharing this runner (P0-4). An unknown
    // id is a safe no-op (the process already closed and removed itself).
    const child = this.active.get(processId);
    if (child) this.killTree(child);
    return ok(undefined);
  }

  /**
   * Terminates a child and the whole process tree it launched. On Windows the
   * tracked child is the `cmd.exe` shim wrapper (`.cmd` shims need a shell), and
   * `child.kill()` only stops that wrapper — leaving the npm/node/Cucumber tree
   * running and still writing the shared reports directory. `taskkill /T` kills
   * the wrapper and its descendants; `/F` forces it. POSIX has no shim wrapper,
   * so a direct kill suffices.
   */
  private killTree(child: ChildProcess): void {
    if (this.platform === "win32" && child.pid !== undefined) {
      const killed = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      // Fall back to a direct kill if taskkill is unavailable for any reason.
      if (killed.error) child.kill();
      return;
    }
    // POSIX: the child was spawned `detached`, so it leads its own process
    // group. Signal the whole group (negative pid) to terminate npm AND the
    // Cucumber/node process it launched, not just the wrapper.
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGTERM");
        return;
      } catch {
        // Group gone / unsupported — fall through to a direct kill.
      }
    }
    child.kill();
  }

  private spawn(
    request: RunCommandRequest,
    onOutput?: (output: RunnerOutput) => void,
  ): Promise<Result<RunnerCommandResult>> {
    return new Promise((resolve) => {
      const started = Date.now();
      // Register under the caller's cancellation handle (e.g. runId) when given,
      // so cancel(processId) targets exactly this child; otherwise an internal
      // id keeps it tracked for cleanup but unreachable by external cancel.
      const id = request.processId ?? `proc-${++this.counter}`;
      let settled = false;
      const finish = (result: Result<RunnerCommandResult>) => {
        if (settled) return;
        settled = true;
        this.active.delete(id);
        resolve(result);
      };

      const [program, ...args] = request.args;
      const display = request.args.join(" ");
      let child: ChildProcess;
      try {
        const spawnOptions = { cwd: request.cwd, env: { ...process.env, ...request.env } };
        const programBase = (program.split(/[/\\]/).pop() ?? program).toLowerCase();
        const isCmdShim = /^(npm|npx)(\.cmd)?$/.test(programBase);
        if (this.platform === "win32" && isCmdShim) {
          // ONLY the `npm`/`npx` `.cmd` shims need a shell (Node refuses to launch
          // .cmd without one, CVE-2024-27980); other programs — e.g. a configured
          // `node.exe` path, possibly with spaces — are spawned directly below
          // (shell: false), avoiding cmd's quoting quirks.
          // Rather than `shell: true` (which doesn't escape an args array —
          // DEP0190 — so spaces/metacharacters break boundaries), invoke cmd.exe
          // with each token explicitly quoted and pass it verbatim.
          // cmd performs percent-delimited expansion (`%VAR%`, and substring/
          // modifier forms like `%PATH:~0,1%`) on the command line with no
          // reliable escape — and `%` signs can even pair ACROSS tokens once
          // they're joined. Identifier-shaped matching misses the modifier
          // forms and cross-token pairing, so since these args are meant to be
          // literal, reject ANY `%` on the cmd path. (POSIX passes everything
          // literally below, so a `%` stays runnable there.)
          if (request.args.some((arg) => arg.includes("%"))) {
            finish({
              ok: false,
              error: appError(
                "COMMAND_DISALLOWED",
                `Argument contains a "%" cmd.exe would expand on Windows: ${display}`,
              ),
            });
            return;
          }
          const comspec = process.env.ComSpec ?? "cmd.exe";
          // The per-token quoting + outer-quote wrapping is a pure builder
          // (buildCmdShimCommandLine) so the exact `cmd /s /c` command line is
          // unit-testable without spawning a real cmd.exe.
          const line = buildCmdShimCommandLine(request.args);
          child = this.spawnFn(comspec, ["/d", "/s", "/c", line], {
            ...spawnOptions,
            windowsVerbatimArguments: true,
          });
        } else {
          // POSIX: no shell — args are literal, never re-parsed (TIS §13.2).
          // `detached` puts the child in its own process group so cancel() can
          // signal the WHOLE tree (npm → node → Cucumber), not just the wrapper.
          child = this.spawnFn(program, args, {
            ...spawnOptions,
            shell: false,
            detached: true,
          });
        }
      } catch (cause) {
        finish({
          ok: false,
          error: appError("INIT_FAILED", `Could not spawn: ${display}`, { cause }),
        });
        return;
      }
      this.active.set(id, child);

      let stdout = "";
      let stderr = "";
      // Stream `data` chunks are NOT guaranteed to land on newline boundaries —
      // a Cucumber line can split across two chunks, and a chunk can end mid-line.
      // Buffer each stream's tail and only publish COMPLETE lines, holding the
      // trailing partial until the next chunk (flushed on close) so the live
      // console never shows a half-line or splits one line into two.
      const tails: { stdout: string; stderr: string } = { stdout: "", stderr: "" };
      const emit = (stream: "stdout" | "stderr", chunk: Buffer) => {
        const text = chunk.toString();
        if (stream === "stdout") stdout += text;
        else stderr += text;
        if (!onOutput) return;
        const segments = (tails[stream] + text).split(/\r?\n/);
        tails[stream] = segments.pop() ?? ""; // trailing partial — hold for next chunk
        for (const line of segments) {
          if (line.length > 0) onOutput({ stream, line, timestamp: new Date().toISOString() });
        }
      };
      const flushTail = (stream: "stdout" | "stderr") => {
        if (!onOutput) return;
        const line = tails[stream];
        tails[stream] = "";
        if (line.length > 0) onOutput({ stream, line, timestamp: new Date().toISOString() });
      };
      child.stdout?.on("data", (chunk: Buffer) => emit("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => emit("stderr", chunk));
      child.on("error", (cause) =>
        finish({
          ok: false,
          error: appError("INIT_FAILED", `Process error: ${display}`, { cause }),
        }),
      );
      child.on("close", (code) => {
        flushTail("stdout");
        flushTail("stderr");
        finish(ok({ exitCode: code ?? -1, stdout, stderr, durationMs: Date.now() - started }));
      });
    });
  }
}
