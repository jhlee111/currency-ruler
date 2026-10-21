// Cuts a release: bumps the version, tags it, builds, deploys to Cloudflare and pushes.
//
//   pnpm release          release the version already in package.json (the first one, or a retry)
//   pnpm release patch    1.0.0 → 1.0.1   fixes
//   pnpm release minor    1.0.0 → 1.1.0   new features
//   pnpm release major    1.0.0 → 2.0.0   big changes
//
// The tag vX.Y.Z marks the commit that was deployed, and Cloudflare's deployment carries the
// same name as its message, so either side leads to the other (and `wrangler rollback` works).
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const read = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()
const fail = (message) => {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

const bump = process.argv[2]
if (bump && !['patch', 'minor', 'major'].includes(bump)) fail('Usage: pnpm release [patch|minor|major]')
if (read('git status --porcelain')) fail('Commit or stash your changes first; a release is built from a clean tree.')
if (read('git rev-parse --abbrev-ref HEAD') !== 'main') fail('Releases are cut from main.')

const pkgUrl = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'))
let version = pkg.version
if (bump) {
  const [major, minor, patch] = version.split('.').map(Number)
  version = bump === 'major' ? `${major + 1}.0.0` : bump === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
}
const tag = `v${version}`
if (read(`git tag --list ${tag}`)) fail(`${tag} is already released. Use patch, minor or major for a new version.`)

if (bump) {
  pkg.version = version
  writeFileSync(pkgUrl, `${JSON.stringify(pkg, null, 2)}\n`)
  run(`git commit --quiet --all --message "Release ${tag}"`)
}
// Built after the version commit, so the app shows this version and this commit.
run(`git tag --annotate ${tag} --message "Release ${tag}"`)

console.log(`\n→ Building and deploying ${tag}`)
try {
  run('pnpm build')
  run(`pnpm exec wrangler deploy --message "${tag}"`)
} catch {
  run(`git tag --delete ${tag}`)
  fail(`Deploy failed, so ${tag} is untagged again. Fix it and run "pnpm release" (no argument) to retry this version.`)
}

run('git push --follow-tags')
console.log(`\n✓ Released ${tag}`)
