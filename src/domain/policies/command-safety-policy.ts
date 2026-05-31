import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Guards runner commands against shell metacharacters that imply destructive
 * or chained operations (TIS §14.2 rule 3). V1 runner commands come from
 * trusted settings defaults (OQ-004), so this is defense-in-depth before a
 * command string is handed to a shell.
 *
 * Pure and I/O-free, so it is trivially unit-testable.
 */
export interface CommandSafetyPolicy {
  assertSafe(command: string): Result<void>;
}

// Chaining/redirection/substitution that could turn a benign command
// destructive: && || ; | & > < ` $( ) newline, and a bare `rm` token.
const DANGEROUS = /(\|\||&&|[;|&<>`]|\$\(|\n|\r)/;
const DESTRUCTIVE_TOKEN = /(^|\s)(rm|rmdir|del|format|mkfs|dd)(\s|$)/i;

export class DefaultCommandSafetyPolicy implements CommandSafetyPolicy {
  assertSafe(command: string): Result<void> {
    const trimmed = command.trim();
    if (trimmed === "") {
      return err(appError("COMMAND_DISALLOWED", "Command must not be empty."));
    }
    if (DANGEROUS.test(command)) {
      return err(
        appError("COMMAND_DISALLOWED", `Command contains shell metacharacters: "${command}".`, {
          details: { command },
        }),
      );
    }
    if (DESTRUCTIVE_TOKEN.test(command)) {
      return err(
        appError("COMMAND_DISALLOWED", `Command contains a destructive operation: "${command}".`, {
          details: { command },
        }),
      );
    }
    return ok(undefined);
  }
}
