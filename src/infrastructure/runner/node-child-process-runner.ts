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

  run(request: RunCommandRequest): Promise<Result<RunnerCommandResult>> {
    return this.spawn(request);
  }

  runStreaming(
    request: RunCommandRequest,
    onOutput: (output: RunnerOutput) => void,
  ): Promise<Result<RunnerCommandResult>> {
    return this.spawn(request, onOutput);
  }

  async cancel(_processId: string): Promise<Result<void>> {
    // V1 cancels the active install/run; finer-grained targeting arrives with
    // the test-execution epic.
    for (const child of this.active.values()) this.killTree(child);
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
    if (process.platform === "win32" && child.pid !== undefined) {
      const killed = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      // Fall back to a direct kill if taskkill is unavailable for any reason.
      if (killed.error) child.kill();
      return;
    }
    child.kill();
  }

  private spawn(
    request: RunCommandRequest,
    onOutput?: (output: RunnerOutput) => void,
  ): Promise<Result<RunnerCommandResult>> {
    return new Promise((resolve) => {
      const started = Date.now();
      const id = `proc-${++this.counter}`;
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
        if (process.platform === "win32" && isCmdShim) {
          // ONLY the `npm`/`npx` `.cmd` shims need a shell (Node refuses to launch
          // .cmd without one, CVE-2024-27980); other programs — e.g. a configured
          // `node.exe` path, possibly with spaces — are spawned directly below
          // (shell: false), avoiding cmd's quoting quirks.
          // Rather than `shell: true` (which doesn't escape an args array —
          // DEP0190 — so spaces/metacharacters break boundaries), invoke cmd.exe
          // with each token explicitly quoted and pass it verbatim.
          // `%` is the one char cmd still expands inside quotes (%VAR%) with no
          // reliable command-line escape, so reject it on Windows (a rare
          // filename/tag case; POSIX passes it through literally below).
          if (request.args.some((arg) => arg.includes("%"))) {
            finish({
              ok: false,
              error: appError(
                "COMMAND_DISALLOWED",
                `Argument contains "%", which cmd.exe would expand on Windows: ${display}`,
              ),
            });
            return;
          }
          const comspec = process.env.ComSpec ?? "cmd.exe";
          // `cmd /s /c` strips the first and last quote of the whole command
          // string, so the per-token quotes would be mangled. Wrap the joined
          // line in one extra outer quote pair — after /s strips it, the inner
          // `"npm" "run" …` boundaries survive (the documented `cmd /s /c ""x" "y""` form).
          const line = `"${request.args.map(quoteForCmd).join(" ")}"`;
          child = spawn(comspec, ["/d", "/s", "/c", line], {
            ...spawnOptions,
            windowsVerbatimArguments: true,
          });
        } else {
          // POSIX: no shell — args are literal, never re-parsed (TIS §13.2).
          child = spawn(program, args, { ...spawnOptions, shell: false });
        }
      } catch (cause) {
        finish({ ok: false, error: appError("INIT_FAILED", `Could not spawn: ${display}`, { cause }) });
        return;
      }
      this.active.set(id, child);

      let stdout = "";
      let stderr = "";
      const emit = (stream: "stdout" | "stderr", chunk: Buffer) => {
        const text = chunk.toString();
        if (stream === "stdout") stdout += text;
        else stderr += text;
        if (onOutput) {
          for (const line of text.split(/\r?\n/)) {
            if (line.length > 0) onOutput({ stream, line, timestamp: new Date().toISOString() });
          }
        }
      };
      child.stdout?.on("data", (chunk: Buffer) => emit("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => emit("stderr", chunk));
      child.on("error", (cause) =>
        finish({ ok: false, error: appError("INIT_FAILED", `Process error: ${display}`, { cause }) }),
      );
      child.on("close", (code) =>
        finish(ok({ exitCode: code ?? -1, stdout, stderr, durationMs: Date.now() - started })),
      );
    });
  }
}
