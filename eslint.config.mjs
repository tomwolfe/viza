import { defineConfig, globalIgnores } from "eslint/config";
import nextVitalsConfig from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  nextVitalsConfig,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
