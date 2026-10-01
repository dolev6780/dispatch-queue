import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const tool = (name) => readFileSync(new URL(`./tools/${name}`, import.meta.url))

// Where the website is published: the agents on the lab PCs answer only it,
// open its Automation page, and update themselves from its copy of the agent.
const SITE_URL = 'https://dolev6780.github.io/dispatch-queue/'

/**
 * The dispatch automation agent, as the one file people download:
 * nblab-automation.cmd. Its first lines are a Windows batch script that runs
 * the rest of the same file in PowerShell (inside <# #>, PowerShell skips
 * them); the rest is tools/nblab-automation.ps1 with the website's address
 * filled in (and its public Firebase key, which agents 2.2 look for before
 * taking an update).
 * Batch files need Windows line endings.
 */
export const agentCmd = (env) => {
  const script = tool('nblab-automation.ps1').toString('utf8')
    .replace('__NBLAB_SITE_URL__', env.VITE_SITE_URL || SITE_URL)
    .replace('__NBLAB_FIREBASE_API_KEY__', env.VITE_FIREBASE_API_KEY || '')
  const run = "& ([scriptblock]::Create([IO.File]::ReadAllText($env:NBLAB_SELF))) -Self $env:NBLAB_SELF -Test $env:NBLAB_TEST -Setup:($env:NBLAB_SETUP -eq '1')"
  // The agent itself is started with no console at all (CreateNoWindow):
  // "-WindowStyle Hidden" is ignored when Windows Terminal hosts consoles
  // (the Windows 11 default), which left a window open the whole time.
  const detach = "$s = New-Object Diagnostics.ProcessStartInfo 'powershell.exe'; " +
    "$s.Arguments = '-NoProfile -ExecutionPolicy Bypass -Command ' + [char]34 + $env:NBLAB_RUN + [char]34; " +
    '$s.CreateNoWindow = $true; $s.UseShellExecute = $false; [void][Diagnostics.Process]::Start($s)'
  const starter = [
    '<# :',
    '@echo off',
    'rem NBLAB dispatch automation agent. Double-click to start it; it runs next to the clock, with no window.',
    'rem Set it up on the website (Automation page). Also: nblab-automation.cmd -Test "C:\\path\\to\\file.pdf"',
    'setlocal',
    'set "NBLAB_SELF=%~f0"',
    'set "NBLAB_TEST="',
    'set "NBLAB_SETUP="',
    'if /i "%~1"=="-Test" set "NBLAB_TEST=%~2"',
    'if /i "%~1"=="-Setup" set "NBLAB_SETUP=1"',
    `set "NBLAB_RUN=${run}"`,
    'if defined NBLAB_TEST (',
    '  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "%NBLAB_RUN%"',
    ') else (',
    `  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${detach}"`,
    ')',
    'exit /b',
    '#>',
    ''
  ].join('\n')
  return Buffer.from((starter + script).replace(/\r?\n/g, '\r\n'), 'utf8')
}

/**
 * The lab-PC tools are published next to the app under fixed names: the
 * ServiceNow watcher, so the Install button can link to it and Tampermonkey
 * can check it for updates (a URL ending in .user.js is what makes
 * Tampermonkey offer to install it), the relay, and the automation agent.
 */
const labTools = (env) => {
  const files = {
    'servicenow-watcher.user.js': () => tool('servicenow-watcher.user.js'),
    'servicenow-relay.mjs': () => tool('servicenow-relay.mjs'),
    'nblab-automation.cmd': () => agentCmd(env)
  }
  return {
    name: 'lab-tools',
    configureServer(server) {
      for (const [name, source] of Object.entries(files)) {
        server.middlewares.use(`/${name}`, (req, res) => {
          res.setHeader('Content-Type', name.endsWith('.cmd') ? 'application/octet-stream' : 'text/javascript; charset=utf-8')
          res.end(source())
        })
      }
    },
    generateBundle() {
      for (const [name, source] of Object.entries(files)) this.emitFile({ type: 'asset', fileName: name, source: source() })
    }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), labTools(loadEnv(mode, process.cwd(), 'VITE_'))]
}))
