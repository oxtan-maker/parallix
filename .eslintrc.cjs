module.exports = {
  env: {
    node: true,
    es2024: true
  },
  parserOptions: {
    ecmaVersion: 2024,
    sourceType: "module"
  },
  rules: {
    "no-undef": "error",
    "no-unused-vars": "error",
    "valid-typeof": "error",
    "no-unreachable": "error",
    "no-async-promise-executor": "error",
    "eqeqeq": "error",
    "curly": "error",
    "no-var": "error"
  }
};
