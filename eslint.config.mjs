/**
 * THIS FILE WAS AUTO-GENERATED.
 * PLEASE DO NOT EDIT IT MANUALLY.
 * ===============================
 * IF YOU'RE COPYING THIS INTO AN ESLINT CONFIG, REMOVE THIS COMMENT BLOCK.
 */

import path from 'node:path';

import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import { configs, plugins } from 'eslint-config-airbnb-extended';
import { rules as prettierConfigRules } from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';

const gitignorePath = path.resolve('.', '.gitignore');

const jsConfig = [
  // ESLint Recommended Rules
  {
    name: 'js/config',
    ...js.configs.recommended,
  },
  // Stylistic Plugin
  plugins.stylistic,
  // Import X Plugin
  plugins.importX,
  // Airbnb Base Recommended Config
  ...configs.base.recommended,
];

const reactConfig = [
  // React Plugin
  plugins.react,
  // React Hooks Plugin
  plugins.reactHooks,
  // React JSX A11y Plugin
  plugins.reactA11y,
  // Airbnb React Recommended Config
  ...configs.react.recommended,
];

const typescriptConfig = [
  // TypeScript ESLint Plugin
  plugins.typescriptEslint,
  // Airbnb Base TypeScript Config
  ...configs.base.typescript,
  // Airbnb React TypeScript Config
  ...configs.react.typescript,
];

const prettierConfig = [
  // Prettier Plugin
  {
    name: 'prettier/plugin/config',
    plugins: {
      prettier: prettierPlugin,
    },
  },
  // Prettier Config
  {
    name: 'prettier/config',
    rules: {
      ...prettierConfigRules,
      'prettier/prettier': 'error',
    },
  },
];

export default [
  // Ignore .gitignore files/folder in eslint
  includeIgnoreFile(gitignorePath),
  // Javascript Config
  ...jsConfig,
  // React Config
  ...reactConfig,
  // TypeScript Config
  ...typescriptConfig,
  // Prettier Config
  ...prettierConfig,
  // Overrides
  {
    rules: {
      'import-x/prefer-default-export': 'off',
      'react/require-default-props': 'off',
    },
  },
  // src/kobo is the Kobo Libra 2 installer, ported from the libra2-linux
  // repository with its logic carried across unchanged. Two things follow.
  //
  // Its relative imports name the file they resolve to, because `yarn test`
  // runs these sources under node with no bundler in front of them, and node
  // does not guess an extension.
  //
  // Its loops are the ported ones: over the profile's checks, over a manifest's
  // artefact fields, over the install's writes and over the replies a
  // bootloader sends. Rewriting them as array methods would be a rewrite, and
  // the point of this directory is that it is not one. `void err` and
  // `void usb` are the ported marks for an argument deliberately ignored, and
  // fastboot.ts is one protocol plus the error type it throws.
  {
    name: 'kobo/ported',
    files: ['src/kobo/**/*.ts'],
    rules: {
      'import-x/extensions': 'off',
      'no-restricted-syntax': 'off',
      'no-continue': 'off',
      'no-void': 'off',
      'max-classes-per-file': 'off',
      '@typescript-eslint/prefer-destructuring': 'off',
    },
  },
];
