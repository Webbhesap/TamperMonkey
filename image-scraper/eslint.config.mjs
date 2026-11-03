export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', navigator: 'readonly',
        GM_getValue: 'readonly', GM_setValue: 'readonly', GM_deleteValue: 'readonly', GM_setClipboard: 'readonly',
        GM_xmlhttpRequest: 'readonly', GM_getResourceText: 'readonly', GM_getResourceURL: 'readonly', GM_info: 'readonly',
        DOMParser: 'readonly', Blob: 'readonly', URL: 'readonly', Uint8Array: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        AbortController: 'readonly', DOMException: 'readonly', crypto: 'readonly', btoa: 'readonly', atob: 'readonly', alert: 'readonly',
        confirm: 'readonly', fetch: 'readonly', Image: 'readonly', matchMedia: 'readonly', createImageBitmap: 'readonly', JSZip: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        console: 'readonly', navigator: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly', scrollX: 'readonly', scrollY: 'readonly',
        scrollTo: 'readonly', scrollBy: 'readonly', ImageBitmap: 'readonly', FileReader: 'readonly', StructuredClone: 'readonly', structuredClone: 'readonly',
        GM: 'readonly', unsafeWindow: 'readonly', TextDecoderStream: 'readonly', Response: 'readonly', Request: 'readonly', Headers: 'readonly', FormData: 'readonly',
        getComputedStyle: 'readonly', queueMicrotask: 'readonly', performance: 'readonly', DataTransfer: 'readonly', File: 'readonly',
      },
    },
    rules: { 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', vars: 'all' }], 'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error', 'no-self-assign': 'warn', 'no-useless-escape': 'warn' },
  },
  { ignores: ['lib/**', 'tests/**', 'node_modules/**'] },
];
