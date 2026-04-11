import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import net from 'net'

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

export default defineConfig(async () => {
  const apiTarget = await pickApiTarget()

  return {
    plugins: [react()],
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
      port: 3001,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true
        }
      }
    }
  }
})
