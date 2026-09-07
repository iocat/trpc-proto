import tsParser from '@typescript-eslint/parser';
import jsdoc from 'eslint-plugin-jsdoc';

export default [
  {
    files: ['packages/**/*.ts'],
    ignores: ['packages/**/dist/**'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      jsdoc,
    },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          contexts: ['TSInterfaceDeclaration'],
          enableFixer: false,
          publicOnly: {
            ancestorsOnly: true,
            cjs: false,
            esm: true,
          },
          require: {
            FunctionDeclaration: false,
          },
        },
      ],
    },
  },
];
