import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import builtinModules from "builtin-modules";
import obsidianmd from "eslint-plugin-obsidianmd";
import vitest from "@vitest/eslint-plugin";

// Every Node builtin, as import-specifier globs: bare ("fs"), subpath
// ("fs/promises"), and the "node:" protocol forms. Used by the layer rules
// below to keep Node I/O out of domain/application/presentation/shared (it
// belongs behind ports implemented in src/infrastructure — see ADR-0008 /
// Building Block View §10).
//
// NOTE on the leading "/": `no-restricted-imports` patterns use gitignore
// semantics, where an unanchored single-segment pattern matches that segment
// ANYWHERE in the specifier — the builtins list contains "domain" and
// "events", which would otherwise (falsely) match relative imports like
// "../../domain/events/domain-event". The leading "/" anchors each pattern to
// the start of the specifier, so only bare builtin specifiers match.
const NODE_BUILTIN_IMPORTS = [
  ...builtinModules.flatMap((mod) => [`/${mod}`, `/${mod}/**`]),
  "/node:*",
  "/node:*/**",
];

// "obsidian" (and any subpath), anchored for the same reason as above.
const OBSIDIAN_IMPORTS = ["/obsidian", "/obsidian/**"];

export default tseslint.config(
  {
    ignores: ["main.js", "node_modules/", "dist/", "build/", "coverage/", ".claude/"],
  },
  eslint.configs.recommended,
  ...[...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked].map(
    (config) => ({
      ...config,
      files: ["**/*.ts"],
    }),
  ),
  // Obsidian plugin guidelines (community-plugin review rules): API usage,
  // command/setting conventions, vault/workspace correctness, plus the
  // bundled no-unsanitized/SDL security checks. Every preset entry is
  // re-scoped to the plugin source with an AND-files pattern: the preset's
  // un-scoped entries carry type-aware rules that crash on untyped files
  // (esbuild.config.mjs, scripts/*.mjs), and its rules only concern Obsidian
  // plugin code anyway. The package.json entries are dropped: one would
  // disable type-checked rules wherever it applies, and dependency hygiene is
  // already covered by fallow.
  ...obsidianmd.configs.recommended
    .filter((config) => !config.files?.includes("package.json"))
    .map((config) => ({ ...config, files: [["src/**", "**/*.ts"]] })),
  {
    files: ["src/**/*.ts"],
    rules: {
      // Obsidian's sentence-case guideline, reconciled with CONTEXT.md: the
      // glossary terms are the product language and stay capitalized in
      // user-facing copy; everything else must be sentence case.
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          brands: [
            "Specorator Testrunner",
            "Test Hub",
            "Use Case",
            "Use Cases",
            "Feature Specification",
            "Feature Specifications",
            "Test Suite",
            "Test Suites",
            "Test Run",
            "Test Runs",
            "Test Evidence",
            "Test Console",
            "Evidence Explorer",
            "Tag Expression",
            "Initialization Wizard",
            "Getting Started",
            "Demo Test",
            "Markdown",
            "Playwright",
            "Chromium",
            "Cucumber",
            "Gherkin",
            "Obsidian",
            "GitHub",
            "Node.js",
          ],
          acronyms: ["E2E", "CI", "KPI", "SUT", "URL", "ID", "MB", "PRD"],
          // Environment-variable names quoted verbatim in copy, and Feature
          // Editor labels naming Gherkin keywords (Background:, Scenario:,
          // Examples:) — syntax tokens that are always capitalized.
          ignoreRegex: [
            "\\bBASE_URL\\b",
            "^\\+ (Background|Scenario|Examples block)$",
            "^Delete Examples block$",
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      // strictTypeChecked tuning. Two rules are off because they fight
      // deliberate idioms in this codebase:
      // - no-unnecessary-condition: with `noUncheckedIndexedAccess` off,
      //   index accesses type as defined, so the rule wants the defensive
      //   guards around untrusted data (frontmatter, hand-edited data.json,
      //   argv tokens) and teardown-time `this.service?.` chains DELETED.
      //   Revisit together with a `noUncheckedIndexedAccess` tsconfig change.
      // - no-empty-function: noop fakes, null-loggers, and default progress
      //   reporters are the null-object idiom here; fallow reports actually
      //   dead code.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      // Port/adapter and Obsidian view methods (`onOpen`, `onClose`, fakes,
      // repositories) implement async interface signatures even when a given
      // implementation has no `await`; requiring one would force behavioral
      // contortions, so this stylistic rule is disabled.
      "@typescript-eslint/require-await": "off",
      // Allow intentionally-unused args/vars when prefixed with `_`.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // File-length budget: keep modules small enough to hold in one's head.
    // `warn`, not `error`, on purpose — several files currently exceed 350 and
    // `npm run lint` doesn't pass `--max-warnings`, so this surfaces them as a
    // ratchet to split down over time without breaking CI (CONTRIBUTING.md gate).
    // Blank lines and comments are skipped so the budget counts actual code
    // (LOC): this codebase keeps a deliberately high explanatory-comment density
    // (AGENTS.md) that shouldn't eat into the limit.
    files: ["**/*.ts"],
    rules: {
      "max-lines": ["warn", { max: 350, skipBlankLines: true, skipComments: true }],
    },
  },
  // ── Layer-boundary enforcement (docs/architecture/Building Block View.md §10) ──
  // The hexagonal layering is enforced with per-layer `no-restricted-imports`
  // blocks (specifier-string globs match relative imports like
  // "../../infrastructure/x" as well as bare specifiers):
  //
  //   src/domain          → may import only domain + src/shared
  //   src/application     → + domain, shared (NOT infrastructure/presentation,
  //                         NOT "obsidian", NOT Node builtins — I/O via ports)
  //   src/infrastructure  → anything except presentation
  //   src/presentation    → application/domain/shared + "obsidian"
  //                         (NOT infrastructure — wiring happens in main.ts)
  //   src/shared          → standalone (no layers, no "obsidian", no Node
  //                         builtins); EXCEPTION: type-only domain imports are
  //                         allowed (see the shared block below)
  //   src/main.ts         → composition root; may import anything (no block)
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/application",
                "**/application/**",
                "**/infrastructure",
                "**/infrastructure/**",
                "**/presentation",
                "**/presentation/**",
              ],
              message:
                "Layer violation: src/domain may import only domain and src/shared (Building Block View §10).",
            },
            {
              group: [...OBSIDIAN_IMPORTS],
              message: "Layer violation: src/domain must not depend on the Obsidian API.",
            },
            {
              group: [...NODE_BUILTIN_IMPORTS],
              message:
                "Layer violation: src/domain must not use Node builtins — I/O belongs behind ports in infrastructure.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/infrastructure",
                "**/infrastructure/**",
                "**/presentation",
                "**/presentation/**",
              ],
              message:
                "Layer violation: src/application may import only application, domain, and shared — infrastructure is reached via ports (Building Block View §10).",
            },
            {
              group: [...OBSIDIAN_IMPORTS],
              message:
                "Layer violation: src/application must not depend on the Obsidian API — use the vault/workspace ports.",
            },
            {
              group: [...NODE_BUILTIN_IMPORTS],
              message:
                "Layer violation: src/application must not use Node builtins — I/O belongs behind ports in infrastructure.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/infrastructure/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/presentation", "**/presentation/**"],
              message:
                "Layer violation: src/infrastructure must not import presentation (Building Block View §10).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/presentation/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/infrastructure", "**/infrastructure/**"],
              message:
                "Layer violation: src/presentation may import application/domain/shared + obsidian; infrastructure adapters are wired in main.ts (Building Block View §10).",
            },
            {
              group: [...NODE_BUILTIN_IMPORTS],
              message:
                "Layer violation: src/presentation must not use Node builtins — I/O belongs behind ports in infrastructure.",
            },
          ],
        },
      ],
    },
  },
  {
    // src/shared is standalone — EXCEPT that the event-bus envelope types
    // (DomainEvent/DomainEventType/EventPayloads) and the VaultPath brand are
    // imported TYPE-ONLY from domain (shared/event-bus/*, shared/utils/vault-path).
    // Those are erased at compile time (no runtime dependency), so the domain
    // pattern uses the @typescript-eslint variant with `allowTypeImports` to
    // permit exactly that and nothing more.
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/application",
                "**/application/**",
                "**/infrastructure",
                "**/infrastructure/**",
                "**/presentation",
                "**/presentation/**",
              ],
              message:
                "Layer violation: src/shared is standalone and must not import other layers (Building Block View §10).",
            },
            {
              group: [...OBSIDIAN_IMPORTS],
              message: "Layer violation: src/shared must not depend on the Obsidian API.",
            },
            {
              group: [...NODE_BUILTIN_IMPORTS],
              message:
                "Layer violation: src/shared must not use Node builtins — keep it environment-agnostic.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/domain", "**/domain/**"],
              allowTypeImports: true,
              message:
                "Layer violation: src/shared may reference domain TYPES only (e.g. the event envelope, VaultPath brand) — no runtime domain imports.",
            },
          ],
        },
      ],
    },
  },
  {
    // Node scripts (plain .mjs, not type-checked): give them Node globals so
    // `process`/`console` aren't flagged no-undef. These run under Node directly.
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        __dirname: "readonly",
      },
    },
  },
  {
    // Vitest test hygiene: catches the test anti-patterns agents introduce
    // most often (focused/disabled tests, assertion-free tests, misused
    // matchers). no-focused-tests and no-disabled-tests are errors (TD-006
    // flip) — a stray `.only`/`.skip` silently shrinks CI coverage.
    files: ["tests/**/*.ts"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/no-focused-tests": "error",
      "vitest/no-disabled-tests": "error",
      // vitest supports a failure-message second argument: expect(v, "msg").
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      // Narrowing the Result discriminated union requires asserting inside
      // `if (result.ok) { … }` — the guard is the assertion pattern here, not
      // a flaky conditional test.
      "vitest/no-conditional-expect": "off",
    },
  },
  {
    // Test files exercise fakes/partial mocks and read JSON as `unknown`;
    // relax the unsafe-* rules that are noisy and low-value in tests.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
