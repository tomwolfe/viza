import { defineConfig, globalIgnores } from "eslint/config";
import nextConfig from "eslint-config-next";

const eslintConfig = defineConfig([
  nextConfig,
  globalIgnores([
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
