import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

import { baseRules, strictTsRules } from './rules.mjs';

const commonIgnores = ['dist/**', 'node_modules/**', 'tmp/**'];

const typeAwareParserOptions = ({ project, projectService, tsconfigRootDir }) => ({
  ...(projectService ? { projectService: true } : { project }),
  tsconfigRootDir,
});

export const defineNodePackageConfig = ({
  tsconfigRootDir,
  project,
  projectService = false,
  explicitFunctionReturnType = false,
  additionalIgnores = [],
}) =>
  defineConfig([
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      rules: baseRules({ allowConsole: true }),
    },
    {
      languageOptions: {
        parserOptions: {
          tsconfigRootDir,
        },
      },
    },
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      languageOptions: {
        parserOptions: typeAwareParserOptions({
          project,
          projectService,
          tsconfigRootDir,
        }),
      },
      rules: strictTsRules({ explicitFunctionReturnType }),
    },
    {
      ignores: [...commonIgnores, ...additionalIgnores],
    },
  ]);
