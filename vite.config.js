import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The lab-PC tools are published next to the app under fixed names: the
// ServiceNow watcher, so the Install button can link to it and Tampermonkey
// can check it for updates (a URL ending in .user.js is what makes
// Tampermonkey offer to install it), the relay, and the dispatch automation
// agent with its starter, for the Download buttons.
const TOOLS = ['servicenow-watcher.user.js', 'servicenow-relay.mjs', 'nblab-automation.ps1', 'nblab-automation.cmd']
const toolSource = (name) => readFileSync(new URL(`./tools/${name}`, import.meta.url))

const labTools = () => ({
  name: 'lab-tools',
  configureServer(server) {
    for (const name of TOOLS) {
      server.middlewares.use(`/${name}`, (req, res) => {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.end(toolSource(name))
      })
    }
  },
  generateBundle() {
    for (const name of TOOLS) this.emitFile({ type: 'asset', fileName: name, source: toolSource(name) })
  }
})

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), labTools()],
})
