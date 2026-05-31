import type { Result } from "../../shared/result/result";

/**
 * Spawns child processes for `npm install`, browser install, and runner
 * execution; supports cancellation (TIS §9.5, BBV §7 `ProcessAdapter`).
 */
export interface ChildProcessRunner {
  run(request: RunCommandRequest): Promise<Result<RunnerCommandResult>>;
  runStreaming(
    request: RunCommandRequest,
    onOutput: (output: RunnerOutput) => void,
  ): Promise<Result<RunnerCommandResult>>;
  cancel(processId: string): Promise<Result<void>>;
}

export interface RunCommandRequest {
  command: string;
  cwd: string; // absolute path, must resolve under .testrunner per RunnerExecutionPolicy
  env?: Record<string, string>;
}

export interface RunnerOutput {
  stream: "stdout" | "stderr";
  line: string;
  timestamp: string;
}

export interface RunnerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
