import { defineNodePackageConfig } from './tooling/eslint/node-package.mjs';

export default defineNodePackageConfig({
  tsconfigRootDir: import.meta.dirname,
  project: ['./tsconfig.json', './tsconfig.ui.json', './test/tsconfig.json'],
  explicitFunctionReturnType: true,
});
