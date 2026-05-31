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
      // On Windows, `npm`/`npx` are `.cmd` shims that Node refuses to launch
      // without a shell (CVE-2024-27980), so a shell is required there; on POSIX
      // we keep `shell: false` so args stay literal — no interpolation (TIS §13.2).
      const useShell = process.platform === "win32";
      // Under a shell the args are no longer literal, so reject cmd.exe
      // metacharacters to prevent command splitting/injection on Windows. POSIX
      // (shell: false) passes them through verbatim, so they're allowed there.
      if (useShell && args.some((arg) => /[&|<>^()"%`]/.test(arg))) {
        finish({
          ok: false,
          error: appError(
            "COMMAND_DISALLOWED",
            `Argument contains a shell metacharacter unsupported on Windows: ${display}`,
          ),
        });
        return;
      }
      let child: ChildProcess;
      try {
        child = spawn(program, args, {
          cwd: request.cwd,
          env: { ...process.env, ...request.env },
          shell: useShell,
        });
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
