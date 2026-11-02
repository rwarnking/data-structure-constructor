import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const buildEnvironment = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {}

const repositoryName = buildEnvironment.GITHUB_REPOSITORY?.split('/')[1]

const pagesBase =
  buildEnvironment.GITHUB_ACTIONS === 'true' &&
  repositoryName &&
  !repositoryName.endsWith('.github.io')
    ? `/${repositoryName}/`
    : '/'

export default defineConfig({
  base: pagesBase,
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4174',
    },
  },
})