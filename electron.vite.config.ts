import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Two entries: the app, and the standalone MCP server (node out/main/mcp.js --root <project>), which must not load Electron.
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), mcp: resolve('src/mcp/main.ts') } } }
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: resolve('src/renderer'),
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
