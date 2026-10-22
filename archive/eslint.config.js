import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', performance: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        console: 'readonly', localStorage: 'readonly', AudioContext: 'readonly', Event: 'readonly', EventTarget: 'readonly',
        DOMException: 'readonly', WebGL2RenderingContext: 'readonly', WebGLRenderingContext: 'readonly', URLSearchParams: 'readonly',
        self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly', process: 'readonly', Float32Array: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { ignores: ['vendor/**', 'docs/**', 'node_modules/**'] },
];
