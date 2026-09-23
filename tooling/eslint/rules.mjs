export const baseRules = ({ allowConsole = false } = {}) => ({
  ...(allowConsole ? { 'no-console': 'off' } : {}),
  eqeqeq: ['error', 'always'],
  curly: ['error', 'all'],
  'no-implicit-coercion': 'error',
});

export const strictTsRules = ({ explicitFunctionReturnType = false } = {}) => ({
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
  '@typescript-eslint/prefer-as-const': 'error',
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/typedef': [
    'error',
    {
      parameter: true,
      arrowParameter: true,
    },
  ],
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/no-unnecessary-condition': 'error',
  '@typescript-eslint/strict-boolean-expressions': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
  '@typescript-eslint/prefer-nullish-coalescing': 'error',
  '@typescript-eslint/prefer-optional-chain': 'error',
  '@typescript-eslint/no-deprecated': 'warn',
  ...(explicitFunctionReturnType
    ? { '@typescript-eslint/explicit-function-return-type': 'warn' }
    : {}),
  '@typescript-eslint/consistent-type-assertions': [
    'error',
    {
      assertionStyle: 'as',
      objectLiteralTypeAssertions: 'never',
    },
  ],
});
