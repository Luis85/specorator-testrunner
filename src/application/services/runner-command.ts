import type { ExecutionScope } from "../../domain/entities/test-run";
import type { TestHubSettings } from "../../domain/settings/settings";
import { appError } from "../../shared/errors/errors";
import { err, ok, type Result } from "../../shared/result/result";
import { relativeVaultPath } from "../../shared/utils/vault-path";
import type { SuiteService } from "./suite-service";
import type { UseCaseService } from "./use-case-service";

/**
 * Resolves a scoped test request into the runner invocation (TIS §13.2): the
 * literal argv plus the playwright-bdd scope env. Kept apart from the run
 * lifecycle in test-execution-service so the "what command + scope env does
 * this run need" logic — tokenizing, the npm-run guard, and the per-scope
 * BDD_FEATURES/BDD_TAGS dispatch — reads and tests on its own. Pure aside from
 * the use-case/suite lookups the scope helpers need (passed in as deps).
 */

/**
 * A resolved runner invocation: the literal argv plus any scope-specific env
 * the spawn must carry. The suite scope drives playwright-bdd's native tag
 * filtering through `env.BDD_TAGS` (the generated config reads it) rather than
 * a CLI arg, so the command needs to convey env without mutating the argv.
 */
export interface ResolvedCommand {
  args: string[];
  env?: Record<string, string>;
}

/**
 * Renders an argv as a human-readable display string for `TestRun.command` and
 * the `testrun.started` event. The runner spawns these args with `shell: false`
 * (the PR #7 decision to rework the runner to argv arrays), so this is for
 * display only — args with spaces are quoted purely for readability, never to
 * survive a shell (TIS §13.2).
 */
export const displayCommand = (args: string[]): string =>
  args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ");

// Consumes one character while inside a quote: returns the next quote state and
// accumulated token, plus whether a `\"`/`\\` escape also consumed the following
// char. Only double quotes honour escapes; single quotes are literal. Split out
// of `tokenizeCommand` to keep its loop's cognitive complexity low (TD-008).
const consumeQuoted = (
  ch: string,
  next: string,
  quote: '"' | "'",
  current: string,
): { quote: '"' | "'" | null; current: string; consumedNext: boolean } => {
  if (ch === quote) return { quote: null, current, consumedNext: false };
  if (quote === '"' && ch === "\\" && (next === '"' || next === "\\")) {
    return { quote, current: current + next, consumedNext: true };
  }
  return { quote, current: current + ch, consumedNext: false };
};

/**
 * Tokenizes a configured runner command into argv with shell-style quoting, so
 * a value like `npm run test -- --grep "Open Example Page"`
 * keeps the quoted title as ONE argument (the runner spawns with `shell: false`,
 * so a naive whitespace split would hand Playwright broken `"Open` + `Example`
 * + `Page"` tokens). Single quotes are literal; double quotes allow `\"`
 * and `\\`. An UNquoted backslash is kept literal so Windows path arguments
 * (e.g. `C:\tmp\specs`) survive — it never escapes outside quotes.
 */
// tokenizeCommand is a shell-style tokenizer: its cyclomatic count is inherent
// to the quoting state machine (consumeQuoted already split the inner loop out,
// TD-008), and it is exhaustively unit-tested, so the complexity is suppressed
// rather than fragmented further.
// fallow-ignore-next-line complexity
export const tokenizeCommand = (command: string): string[] => {
  const tokens: string[] = [];
  let current: string | null = null;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      const consumed = consumeQuoted(ch, command[i + 1], quote, current ?? "");
      quote = consumed.quote;
      current = consumed.current;
      if (consumed.consumedNext) i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current = current ?? "";
    } else if (/\s/.test(ch)) {
      if (current !== null) tokens.push(current);
      current = null;
    } else current = (current ?? "") + ch;
  }
  if (current !== null) tokens.push(current);
  return tokens;
};

/** Tokenizes a configured runner command string into argv, or the fallback if blank. */
const toArgv = (command: string, fallback: string[]): string[] => {
  const parts = tokenizeCommand(command);
  return parts.length > 0 ? parts : fallback;
};

/**
 * A test-execution command must be an `npm run <script>` form (TIS §13.2).
 * CommandSafetyPolicy also accepts install/probe commands (`npm install`,
 * `node --version`, `npx playwright install …`) because validation/maintenance
 * need them, so the run path needs this stricter, context-specific check —
 * otherwise a synced/edited `defaultRunCommand` could make a non-test command
 * exit 0 and be reported as a passing run.
 */
const isNpmRun = (argv: string[]): boolean => {
  const program = (argv[0]?.split(/[/\\]/).pop() ?? "").replace(/\.(exe|cmd)$/i, "");
  return program === "npm" && argv[1] === "run";
};

/**
 * The neutral state of BOTH playwright-bdd scope controls. Every scoped spawn
 * spreads this first and overrides only the variable it owns, so a scope that
 * sets just `BDD_TAGS` (suite/demo) or just `BDD_FEATURES` (feature/all/use-case)
 * still passes an explicit empty value for the other. The runner merges
 * `process.env` into each spawn, so without this an ambient `BDD_FEATURES`/
 * `BDD_TAGS` inherited from the shell that launched Obsidian (or a CI env) would
 * leak in and silently re-scope the run; the generated config reads `""` as
 * "no filter" (`process.env.X ? … : default` / `process.env.X || undefined`).
 */
const CLEARED_BDD_SCOPE: Readonly<Record<string, string>> = { BDD_FEATURES: "", BDD_TAGS: "" };

/** The use-case/suite lookups the scope helpers need to resolve feature targets. */
interface RunnerCommandDeps {
  useCaseService: Pick<UseCaseService, "findAll" | "findById">;
  suiteService: Pick<SuiteService, "resolveTagExpression">;
}

/**
 * Resolves the runner invocation for a scope (TIS §13.2): a literal argv plus
 * any scope env. Feature paths are appended verbatim as positional filters
 * (AD-4, no quoting/escaping) — under shell: false they pass through as-is, so
 * a path with `$`, `&`, or spaces survives unchanged (the PR #7 argv rework);
 * playwright-bdd filters by path substring against the trailing
 * `playwright test`. The suite scope instead conveys the tag expression via
 * `env.BDD_TAGS` (the generated config's `defineBddConfig` reads it). A thin
 * dispatch over per-scope helpers — keep it that way.
 */
export const resolveRunnerCommand = async (
  scope: ExecutionScope,
  target: string,
  settings: TestHubSettings,
  deps: RunnerCommandDeps,
): Promise<Result<ResolvedCommand>> => {
  // Honor the user's configured runner commands (a wrapper script, extra
  // flags, a different npm script). Scoped runs convey their scope via the
  // spawn ENV — BDD_TAGS for suites, BDD_FEATURES for feature paths — so
  // `bddgen` generates ONLY the targeted features (the base command is
  // unchanged). This keeps a scoped run from failing because an unrelated
  // feature elsewhere in the vault doesn't parse.
  const base = toArgv(settings.runner.defaultRunCommand, ["npm", "run", "test"]);
  if (!isNpmRun(base)) {
    return err(
      appError(
        "VALIDATION_FAILED",
        `Configured run command must be "npm run <script>": "${settings.runner.defaultRunCommand}".`,
      ),
    );
  }
  switch (scope) {
    case "demo":
      return demoScopeCommand(settings);
    case "all":
      return ok(await allScopeCommand(base, settings, deps.useCaseService));
    case "suite":
      return suiteScopeCommand(base, target, deps.suiteService);
    case "feature":
      return ok({
        args: [...base],
        env: { ...CLEARED_BDD_SCOPE, BDD_FEATURES: featurePath(settings, target) },
      });
    case "use-case":
      return ok(await useCaseScopeCommand(base, settings, target, deps.useCaseService));
  }
};

/**
 * `demo`: the configured smoke command (`npm run test:smoke`). Also sets
 * `BDD_TAGS=@smoke` so the `bddgen` step inside that script generates ONLY
 * @smoke features — otherwise a malformed non-@smoke feature elsewhere would
 * fail generation before `playwright test --grep @smoke` ever filters.
 */
const demoScopeCommand = (settings: TestHubSettings): Result<ResolvedCommand> => {
  const smoke = toArgv(settings.runner.smokeRunCommand, ["npm", "run", "test:smoke"]);
  if (!isNpmRun(smoke)) {
    return err(
      appError(
        "VALIDATION_FAILED",
        `Configured smoke command must be "npm run <script>": "${settings.runner.smokeRunCommand}".`,
      ),
    );
  }
  return ok({ args: smoke, env: { ...CLEARED_BDD_SCOPE, BDD_TAGS: "@smoke" } });
};

/**
 * `all`: bare `base` (the config glob over every feature) unless a Use Case is
 * deprecated (ADR-0012) — then scope generation (via `env.BDD_FEATURES`) to the
 * explicit union of the NON-deprecated UCs' feature paths (every feature is
 * generated from a UC, so that union is "all features minus the retired ones").
 * With no deprecated UCs we keep the cheap glob; if the UC index can't be read
 * we fall back to it rather than silently running nothing. When every
 * non-deprecated UC is unautomated (or all UCs are deprecated) there is no
 * active coverage, so we scope to a path that matches no feature.
 */
const allScopeCommand = async (
  base: string[],
  settings: TestHubSettings,
  useCaseService: Pick<UseCaseService, "findAll">,
): Promise<ResolvedCommand> => {
  const all = await useCaseService.findAll();
  if (!(all.ok && all.value.some((uc) => uc.status === "deprecated"))) {
    // Whole-vault glob: still clear both controls so no ambient scope leaks in.
    return { args: [...base], env: { ...CLEARED_BDD_SCOPE } };
  }
  const activeFiles = all.value
    .filter((uc) => uc.status !== "deprecated")
    .flatMap((uc) => uc.featureFiles);
  if (activeFiles.length > 0) {
    return {
      args: [...base],
      env: { ...CLEARED_BDD_SCOPE, BDD_FEATURES: bddFeatures(settings, activeFiles) },
    };
  }
  // No active coverage: scope generation to a path that matches no feature →
  // zero tests (a clean pass with `--pass-with-no-tests`).
  return {
    args: [...base],
    env: {
      ...CLEARED_BDD_SCOPE,
      BDD_FEATURES: `${featurePrefix(settings)}/__no_active_features__.feature`,
    },
  };
};

/**
 * `suite`: resolve the tag expression and convey it via `env.BDD_TAGS` (the
 * generated `defineBddConfig` reads it; bddgen applies the FULL cucumber tag
 * expression at generation). NO CLI arg — the base command is unchanged.
 */
const suiteScopeCommand = async (
  base: string[],
  target: string,
  suiteService: Pick<SuiteService, "resolveTagExpression">,
): Promise<Result<ResolvedCommand>> => {
  const tags = await suiteService.resolveTagExpression(target);
  if (!tags.ok) return err(tags.error);
  return ok({ args: [...base], env: { ...CLEARED_BDD_SCOPE, BDD_TAGS: tags.value } });
};

/**
 * `use-case` (UC-011): scope generation (via `env.BDD_FEATURES`) to the Use
 * Case's declared featureFiles. Falls back to the `<UC-id>-*.feature` glob when
 * the UC or its links can't be resolved (e.g. a brand-new UC with the standard
 * naming) — bddgen expands the glob.
 */
const useCaseScopeCommand = async (
  base: string[],
  settings: TestHubSettings,
  target: string,
  useCaseService: Pick<UseCaseService, "findById">,
): Promise<ResolvedCommand> => {
  const found = await useCaseService.findById(target);
  const featureFiles = found.ok && found.value ? found.value.featureFiles : [];
  if (featureFiles.length > 0) {
    return {
      args: [...base],
      env: { ...CLEARED_BDD_SCOPE, BDD_FEATURES: bddFeatures(settings, featureFiles) },
    };
  }
  return {
    args: [...base],
    env: {
      ...CLEARED_BDD_SCOPE,
      BDD_FEATURES: `${featurePrefix(settings)}/${target}-*.feature`,
    },
  };
};

/**
 * Newline-separated runner-relative feature paths for `env.BDD_FEATURES` (the
 * generated config splits on `\n`). Newline — not comma — because a vault path
 * may contain a comma but never a control character.
 */
const bddFeatures = (settings: TestHubSettings, targets: string[]): string =>
  targets.map((target) => featurePath(settings, target)).join("\n");

/**
 * A single Feature as a runner-relative path for `BDD_FEATURES` (the generated
 * config's `features`, resolved relative to the runner dir). bddgen generates
 * ONLY the features in BDD_FEATURES, so an unrelated/malformed feature
 * elsewhere never blocks a scoped run.
 */
const featurePath = (settings: TestHubSettings, target: string): string => {
  const prefix = settings.paths.featureFilesPath;
  // Accept a vault path or a bare basename; reduce to the file path relative
  // to the configured features folder, then re-anchor to the runner cwd.
  const basename = target.startsWith(`${prefix}/`)
    ? target.slice(prefix.length + 1)
    : (target.split("/").pop() ?? target);
  return `${featurePrefix(settings)}/${basename}`;
};

/** Runner-cwd-relative features folder, e.g. `../Specifications/features`. */
const featurePrefix = (settings: TestHubSettings): string =>
  relativeVaultPath(settings.paths.testRunnerPath, settings.paths.featureFilesPath);
