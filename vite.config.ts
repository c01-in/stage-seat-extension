import path from 'node:path'
import fs from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const packageJsonPath = path.resolve(__dirname, 'package.json')

function readPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    version: string
  }
  return packageJson.version
}

function syncManifestVersion(): Plugin {
  return {
    name: 'sync-manifest-version',
    apply: 'build',
    buildStart() {
      this.addWatchFile(packageJsonPath)
    },
    generateBundle() {
      const manifestPath = path.resolve(__dirname, 'public', 'manifest.json')
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version: string }
      manifest.version = readPackageVersion()
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), syncManifestVersion()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, 'sidepanel.html'),
        offscreen: path.resolve(__dirname, 'offscreen.html'),
        background: path.resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === 'background'
            ? 'background.js'
            : 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
