import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/out/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/*/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['./*', '../*'],
              message: 'Use the app import aliases for source modules and assets.'
            }
          ]
        }
      ]
    }
  }
)
