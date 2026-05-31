import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Validates a runner argv before it is spawned (TIS §14.2 rule 3). The runner
 * now spawns with `shell: false` (the PR #7 decision to rework the runner to
 * argv arrays), so there is no shell to defend against metacharacters — feature
 * paths/tags with `$`, `&`, or spaces are literal arguments. Instead this guards
 * that the program is an allowed binary and that no argument smuggles a NUL or
 * newline. V1 argv come from trusted settings defaults (OQ-004), so this is
 * defense-in-depth.
 *
 * Pure and I/O-free, so it is trivially unit-testable.
 */
export interface CommandSafetyPolicy {
  assertSafe(args: string[]): Result<void>;
}

// Only the package-manager / Node binaries the runner ever invokes (R3).
const ALLOWED_PROGRAMS = new Set(["npm", "npx", "node"]);
// NUL / newline / carriage return in an argv entry would be a smuggling attempt.
const CONTROL_CHARS = /[\0\n\r]/;

export class DefaultCommandSafetyPolicy implements CommandSafetyPolicy {
  assertSafe(args: string[]): Result<void> {
    const program = args[0]?.trim();
    if (!program) {
      return err(appError("COMMAND_DISALLOWED", "Command must not be empty."));
    }
    const display = args.join(" ");
    // Match on the basename (sans .exe/.cmd) so a configured absolute or
    // version-manager Node path (e.g. /opt/homebrew/bin/node, a Windows
    // node.exe) is allowed — RunnerSettings.nodeExecutable exists to be set.
    const basename = (program.split(/[/\\]/).pop() ?? program).replace(/\.(exe|cmd)$/i, "");
    if (!ALLOWED_PROGRAMS.has(basename)) {
      return err(
        appError("COMMAND_DISALLOWED", `Command program is not allowed: "${program}".`, {
          details: { command: display },
        }),
      );
    }
    if (args.some((arg) => CONTROL_CHARS.test(arg))) {
      return err(
        appError("COMMAND_DISALLOWED", `Command argument contains a control character: "${display}".`, {
          details: { command: display },
        }),
      );
    }
    return ok(undefined);
  }
}
