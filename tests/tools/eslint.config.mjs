// Test-only lint config: finds names used but never defined or imported (the main risk when code moves
// between modules), and unused imports. Not part of the app; the app has no build step.
import { readFileSync } from 'node:fs';
const browser = Object.fromEntries(JSON.parse(readFileSync(new URL('./browser-globals.json', import.meta.url), 'utf8')).map((n) => [n, 'readonly']));
export default [{
  files: ['js/**/*.js', 'sw.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...browser, structuredClone: 'readonly', caches: 'readonly', self: 'readonly', clients: 'readonly' } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-duplicate-case': 'error', 'no-fallthrough': 'off' }
}];
