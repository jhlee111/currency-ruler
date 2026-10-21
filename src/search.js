import { CODES, CURRENCIES } from './currencies.js'

// Lower-case and strip accents, so "krona" finds "Icelandic króna".
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const words = (s) => s.split(/[\s\-()&,.]+/).filter(Boolean)

// Everyday names people type that aren't in the official ones.
const ALIASES = {
  AED: ['uae', 'dubai', 'abu dhabi'],
  CNY: ['rmb', 'renminbi'],
  EUR: ['eurozone'],
  GBP: ['uk', 'britain', 'great britain', 'england', 'scotland', 'sterling'],
  USD: ['us', 'usa', 'america'],
}

// When matches are equally good, more widely used currencies come first.
const POPULAR = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'KRW', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD', 'TWD', 'THB', 'VND', 'PHP', 'IDR', 'MYR', 'INR', 'NZD', 'MXN', 'TRY', 'AED']
const rank = (code) => {
  const i = POPULAR.indexOf(code)
  return i < 0 ? POPULAR.length : i
}

const INDEX = CODES.map((code) => {
  const c = CURRENCIES[code]
  const name = norm(c.name)
  const regions = c.regionNames.map(norm)
  return {
    code,
    lower: code.toLowerCase(),
    aliases: ALIASES[code] ?? [],
    name,
    nameWords: words(name),
    regions,
    regionWords: regions.flatMap(words),
    symbol: norm(c.symbol.trim()),
  }
})

// How strongly one search word matches one currency; 0 means not at all.
function score(entry, term) {
  if (entry.lower === term) return 100
  if (entry.aliases.includes(term)) return 90
  if (entry.lower.startsWith(term)) return 80
  if (entry.name.startsWith(term)) return 70
  if (entry.nameWords.some((w) => w.startsWith(term))) return 60
  if (entry.regions.some((r) => r.startsWith(term))) return 50
  if (entry.regionWords.some((w) => w.startsWith(term))) return 45
  if (entry.aliases.some((a) => a.startsWith(term))) return 42
  if (entry.symbol === term) return 40
  if (entry.name.includes(term)) return 25
  if (entry.regions.some((r) => r.includes(term))) return 15
  return 0
}

/** Currency codes matching every word of the query, best first. */
export function searchCurrencies(query) {
  const terms = words(norm(query.trim()))
  if (!terms.length) return []
  const hits = []
  for (const entry of INDEX) {
    let total = 0
    for (const term of terms) {
      const s = score(entry, term)
      if (!s) {
        total = 0
        break
      }
      total += s
    }
    if (total) hits.push([total, entry])
  }
  hits.sort((a, b) => b[0] - a[0] || rank(a[1].code) - rank(b[1].code) || a[1].name.localeCompare(b[1].name))
  return hits.map(([, entry]) => entry.code)
}

/** Every currency, by name. */
export const BY_NAME = [...CODES].sort((a, b) => CURRENCIES[a].name.localeCompare(CURRENCIES[b].name))
