import { type ChildProcess, spawn } from "node:child_process";
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
    for (const child of this.active.values()) child.kill();
    return ok(undefined);
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
        if (process.platform === "win32") {
          // `npm`/`npx` are `.cmd` shims Node refuses to launch without a shell
          // (CVE-2024-27980). Rather than `shell: true` (which doesn't escape an
          // args array — DEP0190 — so spaces/metacharacters break boundaries),
          // invoke cmd.exe with each token explicitly quoted and pass it
          // verbatim, so args stay literal (spaces + `&` etc. preserved).
          const comspec = process.env.ComSpec ?? "cmd.exe";
          const line = request.args.map(quoteForCmd).join(" ");
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
