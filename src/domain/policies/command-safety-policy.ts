import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";

/**
 * Validates a runner argv before it is spawned (TIS §14.2 rule 3, ADR-0010).
 * The runner spawns with `shell: false` (the PR #7 decision to rework the runner
 * to argv arrays), so there is no shell to defend against metacharacters —
 * feature paths/tags with `$`, `&`, or spaces are literal arguments.
 *
 * Settings can be edited by hand or arrive over Obsidian Sync from another
 * machine (OQ-004), so the program basename alone is not a sufficient guard: a
 * bare `node` allowlist still lets a tampered `runner.defaultRunCommand` smuggle
 * `node -e "<arbitrary code>"`, and a bare `npx` allowlist lets it fetch and run
 * any package. ADR-0010 therefore restricts the runner to a fixed set of argv
 * *shapes* — the exact command forms the runner ever legitimately spawns:
 *
 *   - `<node> --version`                         (Node availability probe)
 *   - `npm --version` | `npm install …` | `npm ci …`
 *   - `npm run <script> [-- …literal args]`      (test execution)
 *   - `npx playwright …`                         (Playwright probe / install)
 *
 * Anything else (e.g. `node -e`, `npx some-package`, `npm exec`) is rejected.
 * Pure and I/O-free, so it is trivially unit-testable.
 */
export interface CommandSafetyPolicy {
  assertSafe(args: string[]): Result<void>;
}

// The package-manager / Node binaries the runner ever invokes (R3).
const ALLOWED_PROGRAMS = new Set(["npm", "npx", "node"]);
// npm subcommands the runner legitimately spawns.
const ALLOWED_NPM_SUBCOMMANDS = new Set(["--version", "install", "ci", "run"]);
// The only npm scripts the runner ever invokes (the generated package.json,
// runner-templates.ts). Restricting `npm run` to these — rather than any
// regex-valid name — stops synced/tampered settings from running an arbitrary
// package script (e.g. `npm run prepare`) under the V1 allowlist (ADR-0010).
const ALLOWED_NPM_SCRIPTS = new Set(["test", "test:smoke", "test:ci"]);
// NUL / newline / carriage return in an argv entry would be a smuggling attempt.
const CONTROL_CHARS = /[\0\n\r]/;

export class DefaultCommandSafetyPolicy implements CommandSafetyPolicy {
  assertSafe(args: string[]): Result<void> {
    const program = args[0]?.trim();
    if (!program) {
      return err(appError("COMMAND_DISALLOWED", "Command must not be empty."));
    }
    const display = args.join(" ");
    const disallow = (reason: string): Result<void> =>
      err(appError("COMMAND_DISALLOWED", reason, { details: { command: display } }));

    if (args.some((arg) => CONTROL_CHARS.test(arg))) {
      return disallow(`Command argument contains a control character: "${display}".`);
    }

    // Match on the basename (sans .exe/.cmd) so a configured absolute or
    // version-manager Node path (e.g. /opt/homebrew/bin/node, a Windows
    // node.exe) is allowed — RunnerSettings.nodeExecutable exists to be set.
    const basename = (program.split(/[/\\]/).pop() ?? program).replace(/\.(exe|cmd)$/i, "");
    if (!ALLOWED_PROGRAMS.has(basename)) {
      return disallow(`Command program is not allowed: "${program}".`);
    }
    // Only `node` (RunnerSettings.nodeExecutable) may be a path — npm/npx must be
    // the bare PATH-resolved command. Otherwise a synced/tampered settings blob
    // could point `installCommand`/run commands at an attacker-controlled
    // executable whose basename is `npm`/`npx` and run arbitrary code (ADR-0010).
    if (basename !== "node" && /[/\\]/.test(program)) {
      return disallow(`${basename} must be the bare command, not a path: "${program}".`);
    }

    const rest = args.slice(1);
    switch (basename) {
      case "node":
        // The runner only ever probes the Node version; nothing else (no `-e`,
        // `--eval`, `-p`, script files). Playwright/bddgen run *inside* an npm script.
        if (rest.length !== 1 || rest[0] !== "--version") {
          return disallow(`Node may only be invoked as "<node> --version": "${display}".`);
        }
        return ok(undefined);
      case "npm": {
        const sub = rest[0];
        if (sub === undefined || !ALLOWED_NPM_SUBCOMMANDS.has(sub)) {
          return disallow(`npm subcommand is not allowed: "${display}".`);
        }
        if (sub === "run") {
          // `npm run <script> [-- …]` — the script must be one the runner owns;
          // anything after `--` is forwarded literally to the runner (shell:false).
          const script = rest[1];
          if (script === undefined || !ALLOWED_NPM_SCRIPTS.has(script)) {
            return disallow(`npm run script is not allowed: "${display}".`);
          }
          // Tokens after the script must be introduced by the `--` forwarding
          // separator. A bare npm option (e.g. `--script-shell ./evil.sh`) would
          // make npm run an arbitrary shell, bypassing the allowlist (ADR-0010).
          if (rest.length > 2 && rest[2] !== "--") {
            return disallow(`npm run options before "--" are not allowed: "${display}".`);
          }
        } else if (sub === "install" || sub === "ci") {
          // Only the bare runner install form. A package spec or flag (e.g.
          // `npm install <pkg>`, `npm install -g <pkg>`) would install arbitrary
          // packages and run their lifecycle scripts from tampered settings
          // (ADR-0010) — reject anything past the subcommand.
          if (rest.length !== 1) {
            return disallow(`npm ${sub} must take no extra arguments: "${display}".`);
          }
        }
        return ok(undefined);
      }
      case "npx":
        // Only the bundled Playwright CLI — never an arbitrary fetched package.
        if (rest[0] !== "playwright") {
          return disallow(`npx may only run "playwright": "${display}".`);
        }
        // And only the install/probe subcommands the runner uses. Other
        // subcommands (e.g. `uninstall --all`) could delete the browsers the
        // runner needs, so reject them (ADR-0010).
        if (rest[1] !== "--version" && rest[1] !== "install") {
          return disallow(`npx playwright subcommand is not allowed: "${display}".`);
        }
        return ok(undefined);
      default:
        return disallow(`Command program is not allowed: "${program}".`);
    }
  }
}
