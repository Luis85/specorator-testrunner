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
  // argv array spawned WITHOUT a shell (no interpolation/word-splitting): args[0]
  // is the program (e.g. "npm"), the rest are literal arguments (TIS §13.2).
  args: string[];
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
