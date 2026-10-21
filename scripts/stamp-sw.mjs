// Writes a hash of the app's files into public/sw.js so each deploy with changed files
// installs a new service worker (and a fresh offline copy) on people's phones.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('../public/', import.meta.url).pathname
const swPath = join(root, 'sw.js')

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const hash = createHash('sha256')
for (const path of files(root).filter((p) => p !== swPath).sort()) {
  hash.update(relative(root, path))
  hash.update(readFileSync(path))
}
const version = hash.digest('hex').slice(0, 12)

const sw = readFileSync(swPath, 'utf8')
const next = sw.replace(/^const VERSION = '[^']*'/m, `const VERSION = '${version}'`)
if (next === sw && !sw.includes(`'${version}'`)) throw new Error('VERSION line not found in sw.js')
writeFileSync(swPath, next)
console.log(`sw.js version ${version}`)
