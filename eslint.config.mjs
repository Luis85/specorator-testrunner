import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import builtinModules from "builtin-modules";

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
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
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
