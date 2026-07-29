module.exports = {
  root: true,
  ignores: ["dist", "node_modules", "out-tsc", "coverage", "public", "*.js"],
  overrides: [
    {
      files: ["*.ts"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: ["tsconfig.json"],
        createDefaultProgram: true
      },
      plugins: ["@typescript-eslint", "@angular-eslint"],
      extends: [
        "plugin:@angular-eslint/recommended",
        "plugin:@angular-eslint/template/process-inline-templates",
        "plugin:@typescript-eslint/recommended",
        "prettier"
      ],
      rules: {
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-explicit-any": "warn",
        "@angular-eslint/directive-selector": ["error", { type: "attribute", prefix: "app", style: "camelCase" }],
        "@angular-eslint/component-selector": ["error", { type: "element", prefix: "app", style: "kebab-case" }]
      }
    },
    {
      files: ["*.html"],
      plugins: ["@angular-eslint/template"],
      extends: ["plugin:@angular-eslint/template/recommended"],
      rules: {}
    }
  ]
}
