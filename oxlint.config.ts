import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react, antiSlop],
  ignorePatterns: [...(core.ignorePatterns ?? []), "apps/web/public/**"],
  jsPlugins: [{ name: "no-comments", specifier: "./tools/oxlint/no-comments.ts" }],
  options: { reportUnusedDisableDirectives: "error", typeAware: true },
  rules: {
    "anti-slop/no-shape-in-symbol-names": "off",
    "eslint/complexity": "off",
    "eslint/func-style": "off",
    "eslint/no-await-in-loop": "off",
    "eslint/no-nested-ternary": "off",
    "eslint/no-plusplus": "off",
    "eslint/no-use-before-define": "off",
    "eslint/prefer-destructuring": "off",
    "eslint/prefer-named-capture-group": "off",
    "eslint/sort-keys": "off",
    "react/function-component-definition": "off",
    "typescript/consistent-return": "off",
    "unicorn/filename-case": "off",
    "unicorn/import-style": "off",
    "unicorn/no-array-for-each": "off",
    "unicorn/no-array-reduce": "off",
    "unicorn/no-await-expression-member": "off",
    "import/no-cycle": "error",
    "no-comments/no-comments": "error",
    "oxc/no-accumulating-spread": "error",
  },
  overrides: [
    {
      files: ["apps/web/src/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "react",
                importNames: ["useEffect", "useLayoutEffect", "useInsertionEffect"],
                message: "Derive in render, act in the event handler, or subscribe with useSyncExternalStore.",
              },
              {
                name: "@antibody/core/node",
                message:
                  "The site runs in the browser: import @antibody/core. core/node is for the CLI, packages and scripts.",
              },
            ],
          },
        ],
      },
    },
  ],
});
