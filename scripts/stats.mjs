// How the app is used, from its anonymous events (worker/index.js → Workers Analytics Engine).
//
//   pnpm stats        the last 7 days
//   pnpm stats 30     the last 30 days
//
// Reading the events takes an API token with Account → Account Analytics → Read. It lives in
// .env.stats, which git ignores, next to the account ID:
//   CF_ACCOUNT_ID=…
//   CF_STATS_TOKEN=…
import { existsSync, readFileSync } from 'node:fs'

const DATASET = 'currency_ruler_events'

const fail = (message) => {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function readEnv(url) {
  if (!existsSync(url)) return {}
  const pairs = readFileSync(url, 'utf8')
    .split('\n')
    .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
  return Object.fromEntries(pairs.map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]))
}

const env = { ...readEnv(new URL('../.env.stats', import.meta.url)), ...process.env }
const account = env.CF_ACCOUNT_ID
const token = env.CF_STATS_TOKEN
if (!account || !token) fail('Put CF_ACCOUNT_ID and CF_STATS_TOKEN in .env.stats (see the top of scripts/stats.mjs).')

const days = Math.max(1, Math.min(90, Number(process.argv[2]) || 7)) // Analytics Engine keeps 3 months
const since = `timestamp > NOW() - INTERVAL '${days}' DAY`
// Events are sampled when traffic is heavy; each row stands for _sample_interval events.
const n = 'SUM(_sample_interval)'

async function query(sql) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: `${sql} FORMAT JSON`,
  })
  if (!res.ok) fail(`Analytics Engine said ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).data
}

function table(title, rows, columns) {
  console.log(`\n${title}`)
  if (!rows.length) return console.log('  (nothing yet)')
  const cells = rows.map((row) => columns.map(([key]) => String(row[key] ?? '')))
  const widths = columns.map(([, label], i) => Math.max(label.length, ...cells.map((c) => c[i].length)))
  const line = (values) => `  ${values.map((v, i) => (i ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join('   ')}`
  console.log(line(columns.map(([, label]) => label)))
  for (const c of cells) console.log(line(c))
}

// "First open of the day" events count daily users without telling devices apart.
const users = `blob1 = 'open' AND double2 = 1 AND ${since}`

const [daily, pairs, added, used, countries, devices, looks, langs] = await Promise.all([
  query(`SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, double2 AS first, ${n} AS n FROM ${DATASET}
    WHERE blob1 = 'open' AND ${since} GROUP BY day, first ORDER BY day`),
  query(`SELECT blob2 AS pair, ${n} AS n FROM ${DATASET} WHERE ${users} GROUP BY pair ORDER BY n DESC LIMIT 12`),
  query(`SELECT blob9 AS pair, ${n} AS n FROM ${DATASET} WHERE blob1 = 'add' AND ${since} GROUP BY pair ORDER BY n DESC LIMIT 12`),
  query(`SELECT blob1 AS event, blob9 AS detail, ${n} AS n FROM ${DATASET} WHERE blob1 != 'open' AND blob1 != 'add' AND ${since}
    GROUP BY event, detail ORDER BY n DESC LIMIT 25`),
  query(`SELECT blob5 AS country, ${n} AS n FROM ${DATASET} WHERE ${users} GROUP BY country ORDER BY n DESC LIMIT 12`),
  query(`SELECT blob3 AS platform, blob4 AS display, ${n} AS n FROM ${DATASET} WHERE ${users} GROUP BY platform, display ORDER BY n DESC`),
  query(`SELECT blob6 AS theme, blob7 AS layout, ${n} AS n, SUM(_sample_interval * double1) AS rulers FROM ${DATASET} WHERE ${users}
    GROUP BY theme, layout ORDER BY n DESC`),
  query(`SELECT blob10 AS lang, ${n} AS n FROM ${DATASET} WHERE ${users} GROUP BY lang ORDER BY n DESC LIMIT 8`),
])

const byDay = {}
for (const row of daily) {
  const day = String(row.day).slice(0, 10)
  byDay[day] ??= { day, opens: 0, users: 0 }
  byDay[day].opens += Number(row.n)
  if (Number(row.first) === 1) byDay[day].users += Number(row.n)
}
const totalUsers = looks.reduce((sum, row) => sum + Number(row.n), 0)
const totalRulers = looks.reduce((sum, row) => sum + Number(row.rulers), 0)

console.log(`Currency Ruler · the last ${days} day${days === 1 ? '' : 's'}`)
table('Each day (users = devices that opened it that day)', Object.values(byDay), [['day', 'day'], ['users', 'users'], ['opens', 'opens']])
table('Ruler in hand when opened (user-days)', pairs, [['pair', 'ruler'], ['n', 'user-days']])
table('Rulers added', added, [['pair', 'ruler'], ['n', 'times']])
table('What people do', used, [['event', 'event'], ['detail', 'detail'], ['n', 'times']])
table('Where (user-days)', countries, [['country', 'country'], ['n', 'user-days']])
table('On what (user-days)', devices, [['platform', 'platform'], ['display', 'opened as'], ['n', 'user-days']])
table('How it looks (user-days)', looks, [['theme', 'theme'], ['layout', 'layout'], ['n', 'user-days']])
table('Languages (user-days)', langs, [['lang', 'language'], ['n', 'user-days']])
if (totalUsers) console.log(`\nRulers kept per device: ${(totalRulers / totalUsers).toFixed(1)} on average`)
