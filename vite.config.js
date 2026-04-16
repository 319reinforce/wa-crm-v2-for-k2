import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import net from 'net'
import fs from 'fs/promises'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const done = (ok) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(200)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function pickApiTarget() {
  const envTarget = process.env.API_PROXY_TARGET || process.env.VITE_API_PROXY_TARGET
  if (envTarget) return envTarget

  const candidates = [3000]
  for (const port of candidates) {
    // pick the first backend port that is already accepting TCP connections
    if (await canConnect(port)) return `http://127.0.0.1:${port}`
  }
  return 'http://127.0.0.1:3000'
}

function tailwindRuntimePlugin() {
  const sourcePattern = 'src/**/*.{html,js,jsx,ts,tsx}'

  return {
    name: 'tailwind-runtime-compile',
    async transform(code, id) {
      const [filepath] = id.split('?')
      if (!filepath || !filepath.endsWith(`${path.sep}src${path.sep}index.css`)) return null

      const compiler = await compile(code, {
        base: process.cwd(),
        from: filepath,
        onDependency() {},
      })

      const scanner = new Scanner({
        sources: [
          { base: process.cwd(), pattern: sourcePattern, negated: false },
        ],
      })

      const candidates = scanner.scan()
      const compiledCss = compiler.build(candidates)

      return {
        code: compiledCss,
        map: null,
      }
    },

    async handleHotUpdate(ctx) {
      if (!ctx.file.includes(`${path.sep}src${path.sep}`)) return
      if (!/\.(html|js|jsx|ts|tsx|css)$/.test(ctx.file)) return
      const cssPath = path.join(process.cwd(), 'src', 'index.css')
      const cssSource = await fs.readFile(cssPath, 'utf8')
      const mod = ctx.server.moduleGraph.getModuleById(cssPath)
      if (!mod) return
      const result = await this.transform(cssSource, cssPath)
      if (!result || typeof result === 'string') return
      mod.transformResult = { code: result.code, map: null, etag: '' }
      return [mod]
    },
  }
}

export default defineConfig(async () => {
  const apiTarget = await pickApiTarget()

  return {
    plugins: [tailwindRuntimePlugin(), react()],
    root: path.join(__dirname, 'src'),
    base: './',
    publicDir: false,
    build: {
      outDir: path.join(__dirname, 'public'),
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        input: path.join(__dirname, 'src/index.html')
      }
    },
    server: {
      host: '0.0.0.0',
      port: 3001,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true
        }
      }
    },
    preview: {
      host: '0.0.0.0',
      port: 3001,
    }
  }
})
