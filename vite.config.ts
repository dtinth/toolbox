import { defineConfig } from "vite-plus";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss()],
  preview: { allowedHosts: true },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    // Enable the broadest reasonable set of built-in plugins. Setting `plugins`
    // overwrites the base set, so the on-by-default ones (eslint, typescript,
    // unicorn, oxc) are listed explicitly. `nextjs`, `vue`, and `jest` are
    // omitted (wrong framework / test runner), and `react-perf` is omitted
    // because its inline-prop rules just fight idiomatic Preact event handlers.
    plugins: [
      "eslint",
      "typescript",
      "unicorn",
      "oxc",
      "import",
      "promise",
      "node",
      "jsx-a11y",
      "react",
      "vitest",
      "jsdoc",
    ],
    // Turn every category up to "error". `restriction` and `nursery` are left
    // off on purpose: `restriction` bundles mutually-exclusive, highly
    // opinionated rules meant to be cherry-picked, and `nursery` rules are
    // still under development. Everything else is the maximum reasonable bar.
    categories: {
      correctness: "error",
      suspicious: "error",
      pedantic: "error",
      perf: "error",
      style: "error",
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",

      // --- Carve-outs from "everything at error" -------------------------
      // The rules below are switched off because enabling them is *not*
      // reasonable for this codebase: they are pure stylistic preference,
      // arbitrary size/metric limits, mutually contradictory with another
      // enabled rule, or straight-up false positives here. Everything not
      // listed stays at error via the categories above.

      // Stylistic preference — no bearing on correctness.
      "eslint/capitalized-comments": "off",
      "eslint/func-style": "off",
      "eslint/id-length": "off",
      "eslint/init-declarations": "off",
      "eslint/no-continue": "off",
      "eslint/no-inline-comments": "off",
      "eslint/no-underscore-dangle": "off",
      "eslint/prefer-destructuring": "off",
      "eslint/sort-imports": "off",
      "eslint/sort-keys": "off",
      "eslint/no-magic-numbers": "off",
      "eslint/no-negated-condition": "off",
      "unicorn/no-negated-condition": "off",

      // Arbitrary size/complexity metrics — not a code-quality gate.
      "eslint/max-lines": "off",
      "eslint/max-lines-per-function": "off",
      "eslint/max-params": "off",
      "eslint/max-statements": "off",
      "react/jsx-max-depth": "off",
      "vitest/max-expects": "off",

      // Contradicts another enabled rule (would make green impossible).
      "eslint/no-ternary": "off", // conflicts with unicorn/prefer-ternary
      "vitest/no-hooks": "off", // conflicts with vitest/require-hook
      "vitest/require-hook": "off", // conflicts with vitest/no-hooks
      "vitest/prefer-strict-boolean-matchers": "off", // conflicts with prefer-to-be-truthy/falsy
      "vitest/prefer-called-once": "off", // conflicts with vitest/prefer-called-times; repo uses `toHaveBeenCalledTimes(1)`

      // `no-duplicate-imports` forbids a second `import type` line from a module
      // already imported for values, while the default "prefer-top-level" of
      // consistent-type-specifier-style demands exactly that — an unsatisfiable
      // pair. Pin the inline style (which this codebase already uses) to keep
      // both rules happy with a single import statement per module.
      "import/consistent-type-specifier-style": ["error", "prefer-inline"],

      // Fights this project's deliberate module conventions (per-tool named
      // exports, CSS side-effect imports, namespace imports, Node in scripts).
      "import/no-named-export": "off",
      "import/prefer-default-export": "off",
      "import/group-exports": "off",
      "import/exports-last": "off",
      "import/no-namespace": "off",
      "import/no-unassigned-import": "off",
      "import/no-nodejs-modules": "off",

      // Too aggressive / excluded from every upstream preset for good reason.
      "typescript/prefer-readonly-parameter-types": "off",
      "typescript/no-unsafe-type-assertion": "off", // routine DOM casts need `as`
      "unicorn/no-null": "off", // `null` is a legitimate DOM/JSON value
      "unicorn/no-useless-undefined": "off", // conflicts with resolving a Promise<T | undefined>, where the arg is required
      "promise/avoid-new": "off", // `new Promise` is needed to wrap callbacks
      "promise/prefer-await-to-callbacks": "off", // event listeners aren't awaitable

      // Documentation-completeness, not correctness; only fires on existing
      // JSDoc blocks and would force exhaustive param/return docs.
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",

      // Noisy test-authoring opinions with no correctness impact.
      "vitest/prefer-expect-assertions": "off",
      "vitest/no-conditional-in-test": "off",
      "vitest/prefer-describe-function-title": "off",
      "vitest/prefer-lowercase-title": "off",

      // Directly contradicts this project's `vite-plus/prefer-vite-plus-imports`
      // rule: test globals come from "vite-plus/test", not "vitest". Its
      // autofix injects a duplicate, untyped `from "vitest"` import.
      "vitest/prefer-importing-vitest-globals": "off",

      // False positive: Preact's automatic JSX runtime (jsxImportSource in
      // tsconfig) means React need not be in scope.
      "react/react-in-jsx-scope": "off",
    },
    overrides: [
      {
        // Tests legitimately poke at internals (e.g. casting Preact VNodes to
        // `any` to assert on their shape) and drive spies/mocks. The type-aware
        // `no-unsafe-*` / `unbound-method` rules are pure noise there, so relax
        // just those for test files while keeping every other rule at error.
        files: ["**/*.test.ts", "**/*.test.tsx"],
        rules: {
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-call": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-unsafe-return": "off",
          "typescript/unbound-method": "off",
        },
      },
      {
        // `scripts/**` are plain, untyped Node ESM build scripts (not in
        // tsconfig's `include`). Type-aware rules see everything as `any`, so
        // the `no-unsafe-*` family only produces noise here.
        files: ["scripts/**"],
        rules: {
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-call": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-unsafe-return": "off",
        },
      },
    ],
    options: { typeAware: true, typeCheck: true, denyWarnings: true, maxWarnings: 0 },
  },
});
