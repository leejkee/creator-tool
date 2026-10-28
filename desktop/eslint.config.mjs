import tsParser from "@typescript-eslint/parser";
import vueParser from "vue-eslint-parser";

const rules = {
  curly: ["error", "all"],
  "nonblock-statement-body-position": ["error", "below"],
  "max-statements-per-line": ["error", { max: 1 }],
};

export default [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
    rules,
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsParser },
    },
    rules,
  },
];
