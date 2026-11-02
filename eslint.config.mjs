import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Flat config (eslint.config.mjs)
// Keep the existing rule coverage, with blocking source hygiene checks below.
export default defineConfig([
  ...nextVitals,
  ...nextTs,

  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "android/**/build/**",
    "ios/**/build/**",
    "lib/vendor/**",
  ]),

  // Project-wide rule tuning (applies to JS/TS in the repo)
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
  rules: {
  "react/no-unescaped-entities": "off",

  "prefer-const": "warn",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/prefer-as-const": "warn",

  // ✅ AJOUT CRITIQUE
  "no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],

  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],

  "@next/next/no-img-element": "warn",
},
  },


  // API routes use dynamic provider payloads; source hygiene is enforced below.
  {
    files: ["app/api/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Dashboard typing and render patterns retain their established rule settings.
  {
    files: ["app/dashboard/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },

  // Server + libs: tolerate third-party payloads and internal helper fallbacks
  {
    files: ["lib/**/*.{ts,tsx}", "middleware.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Source hygiene is blocking in the standard lint command as well as the audit.
  {
    files: ["app/**/*.{js,jsx,ts,tsx}", "lib/**/*.{js,jsx,ts,tsx}", "hooks/**/*.{js,jsx,ts,tsx}", "i18n/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
      "react-hooks/exhaustive-deps": "error",
    },
  },

]);
