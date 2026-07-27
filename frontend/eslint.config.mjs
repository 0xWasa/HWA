import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    "node_modules/**",
    ".next/**",
    ".next-*/**",
    "artifacts/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    rules: {
      // Bigint-only money math is a hard rule of this app; unused vars are allowed
      // with a leading underscore for interface conformance.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The React Compiler is deliberately not enabled for this release. These
      // compiler-oriented rules reject intentional wallet/RPC synchronization
      // effects and render-time clocks used only for labels. Keep the stable
      // Rules of Hooks and exhaustive-deps checks from Next's preset enabled.
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
