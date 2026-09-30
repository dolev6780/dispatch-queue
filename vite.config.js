import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The ServiceNow watcher is published next to the app under a fixed name, so
// the Install button can link to it and Tampermonkey can check it for
// updates. A URL ending in .user.js is what makes Tampermonkey offer to
// install it.
const WATCHER = 'servicenow-watcher.user.js'
const watcherSource = () => readFileSync(new URL(`./tools/${WATCHER}`, import.meta.url))

const servicenowWatcher = () => ({
  name: 'servicenow-watcher',
  configureServer(server) {
    server.middlewares.use(`/${WATCHER}`, (req, res) => {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      res.end(watcherSource())
    })
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: WATCHER, source: watcherSource() })
  }
})

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), servicenowWatcher()],
})
