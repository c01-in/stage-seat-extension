import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const rootDir = process.cwd()
const distDir = path.join(rootDir, 'dist')
const releaseDir = path.join(rootDir, 'release')
const packageJsonPath = path.join(rootDir, 'package.json')

if (!fs.existsSync(distDir)) {
  throw new Error('dist directory was not found. Run the build first.')
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const safeVersion = String(packageJson.version ?? '0.0.0').replace(/[^0-9A-Za-z._-]/g, '-')
const zipName = `stageseat-v${safeVersion}.zip`
const zipPath = path.join(releaseDir, zipName)

fs.mkdirSync(releaseDir, { recursive: true })
if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true })
}

if (process.platform === 'win32') {
  const command = [
    `$dist = '${distDir.replace(/'/g, "''")}'`,
    `$zip = '${zipPath.replace(/'/g, "''")}'`,
    "Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip -Force",
  ].join('; ')

  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { stdio: 'inherit' },
  )
} else {
  execFileSync('zip', ['-qr', zipPath, '.'], {
    cwd: distDir,
    stdio: 'inherit',
  })
}

console.log(`Created ${zipPath}`)
