import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

/** Módulos do `main` autorizados a tocar `fs` (regra do AGENTS.md). */
const FS_OWNERS = [
  'storage',
  'entries-store',
  'auth-store',
  'structure',
  'settings',
  'shred',
  'erase',
  'protocol',
];

const FS_MESSAGE =
  'I/O de disco só nos módulos de persistência do AGENTS.md. Aqui, passe pela VaultStorageFacade.';

const RENDERER_MESSAGE =
  'O renderer e o preload não tocam disco nem Node: o renderer só conhece window.api.';

export default tseslint.config(
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'build/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ----- type-safety máximo -----
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message: 'Evite for-in: use Object.entries()/Object.keys().',
        },
        { selector: 'LabeledStatement', message: 'Labels não são permitidos.' },
        { selector: 'WithStatement', message: 'With não é permitido.' },
      ],
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-template-expression': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/restrict-plus-operands': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/prefer-find': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-meaningless-void-operator': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/no-unnecessary-type-parameters': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'explicit', overrides: { constructors: 'no-public' } },
      ],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: false },
      ],

      // ----- boas práticas gerais -----
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-wrappers': 'error',
      'no-throw-literal': 'error',
      'no-void': ['error', { allowAsStatement: true }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'properties'],
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      curly: ['error', 'all'],
      'dot-notation': 'error',
      'no-implicit-coercion': ['error', { boolean: false, number: false, string: false }],
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',
      'no-useless-rename': 'error',
      'no-duplicate-imports': 'off',
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'electron.vite.config.mts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // A regra do `fs` do AGENTS.md é de fronteira: só alguns módulos do main
    // tocam disco, porque o resto passa pela fachada. Sem isto aqui, um `fs`
    // novo num módulo de domínio passava pelo `check` sem ninguém perceber.
    files: ['src/main/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: FS_MESSAGE },
            { name: 'node:fs', message: FS_MESSAGE },
            { name: 'fs/promises', message: FS_MESSAGE },
            { name: 'fs-extra', message: FS_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    files: [`src/main/{${FS_OWNERS.join(',')}}.ts`],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // O renderer não toca disco nem Node, e o preload é sandboxed: qualquer
    // import de sistema aqui é defeito, não escolha de arquitetura.
    files: ['src/renderer/**/*.{ts,tsx}', 'src/preload/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: RENDERER_MESSAGE },
            { name: 'node:fs', message: RENDERER_MESSAGE },
            { name: 'fs/promises', message: RENDERER_MESSAGE },
            { name: 'fs-extra', message: RENDERER_MESSAGE },
            { name: 'node:child_process', message: RENDERER_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    // Em `src/` vale `no-throw-literal` sem exceção: lá, um literal lançado é
    // sempre descuido. Nos testes a exceção é outra: boa parte das defesas do
    // main só existe porque o valor lançado **não** é um `Error`, e o jeito
    // honesto de expressar "isto é desconhecido em tempo de compilação" é o
    // tipo `unknown`. Trocamos pela variante tipada, que é a que aceita as
    // opções; literal continua barrado, inclusive nos testes.
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      'no-throw-literal': 'off',
      '@typescript-eslint/only-throw-error': [
        'error',
        { allowThrowingAny: false, allowThrowingUnknown: true },
      ],
    },
  },
  {
    files: ['*.mjs', '*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
