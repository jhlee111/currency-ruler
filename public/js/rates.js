// Two rate sources, both as units per 1 USD:
// - ecb: European Central Bank reference rates via frankfurter.dev, ~30 major currencies.
// - market: ExchangeRate-API's open endpoint, ~160 currencies. Its terms allow caching on the
//   device and require a visible credit; they ask for at most one request an hour.

const SOURCES = {
  ecb: {
    url: 'https://api.frankfurter.dev/v1/latest?base=USD',
    cache: 'currency-ruler:rates',
    parse: (body) => ({ date: body.date, rates: { USD: 1, ...body.rates } }),
  },
  market: {
    url: 'https://open.er-api.com/v6/latest/USD',
    cache: 'currency-ruler:market',
    parse: (body) => {
      if (body.result !== 'success') throw new Error('Rate service declined the request')
      return {
        date: new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10),
        rates: body.rates,
        nextUpdate: body.time_next_update_unix * 1000,
      }
    },
  },
}

const HOUR = 60 * 60 * 1000

export function loadCachedRates(kind) {
  try {
    const cached = JSON.parse(localStorage.getItem(SOURCES[kind].cache) || 'null')
    if (cached?.rates && cached?.date) return cached
  } catch {}
  return null
}

export async function fetchRates(kind) {
  const source = SOURCES[kind]
  const signal = AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
  const res = await fetch(source.url, { signal })
  if (!res.ok) throw new Error(`Rate service answered ${res.status}`)
  const data = { ...source.parse(await res.json()), fetchedAt: Date.now() }
  try {
    localStorage.setItem(source.cache, JSON.stringify(data))
  } catch {}
  return data
}

/** Whether the market source is worth asking again: never more than hourly, and not before it updates. */
export function marketDue(cached, now = Date.now()) {
  if (!cached?.fetchedAt) return true
  if (now - cached.fetchedAt < HOUR) return false
  return !cached.nextUpdate || now >= cached.nextUpdate
}
