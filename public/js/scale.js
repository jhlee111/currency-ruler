// Log-scale graduation. A tick is a mantissa `m` (1000…9999, i.e. 1.000…9.999)
// in decade `n`, so its value is m × 10^(n-3). Working in integer mantissas keeps
// the grid free of floating-point drift.

const FADE_FROM = 5.5 // px between ticks where a finer grid starts to appear
const FADE_TO = 11 // px where it is fully drawn

// Each decade splits into 1–2, 2–5, 5–10, every one with a chain of steps
// where each step divides the one before it, so finer grids nest inside coarser ones.
const INTERVALS = [
  [1000, 2000],
  [2000, 5000],
  [5000, 10000],
].map(([a, b]) => ({
  a,
  b,
  chain: [...new Set([b - a, 1000, 500, 100, 50, 10, 5, 1])].filter((s) => s <= b - a && (b - a) % s === 0),
}))

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// Lower rank = more deserving of a label when space is tight.
function rank(m) {
  if (m === 1000) return 0
  if (m === 2000 || m === 5000) return 1
  if (m === 3000 || m === 1500) return 2
  if (m === 4000 || m === 7000 || m === 2500) return 3
  if (m % 1000 === 0 || m === 1200) return 4
  if (m % 500 === 0) return 5
  if (m % 200 === 0) return 6
  if (m % 100 === 0) return 6.5
  if (m % 50 === 0) return 7
  if (m % 20 === 0) return 8
  if (m % 10 === 0) return 8.5
  if (m % 5 === 0) return 9
  return 10
}

/**
 * Ticks covering [lo, hi] (log10 values) at `k` px per decade.
 * Returns [{ n, m, log, alpha, coarse, label }].
 */
export function buildTicks(lo, hi, k, labelGap) {
  const margin = (labelGap * 2) / k
  const from = lo - margin
  const to = hi + margin
  const ticks = []

  for (let n = Math.floor(from); n <= Math.floor(to); n++) {
    for (const { a, b, chain } of INTERVALS) {
      if (n + Math.log10(b / 1000) < from || n + Math.log10(a / 1000) > to) continue

      // The finest step whose tightest gap (at the top of the interval) is still visible.
      let fi = 0
      while (fi + 1 < chain.length && k * Math.log10(b / (b - chain[fi + 1])) >= FADE_FROM) fi++
      const fine = chain[fi]
      const coarse = fi > 0 ? chain[fi - 1] : 0
      const fineAlpha = fi === 0 ? 1 : smoothstep(FADE_FROM, FADE_TO, k * Math.log10(b / (b - fine)))

      const mFrom = Math.max(a, a + Math.ceil((1000 * 10 ** (from - n) - a) / fine) * fine)
      const mTo = Math.min(b - 1, 1000 * 10 ** (to - n))
      for (let m = mFrom; m <= mTo; m += fine) {
        const isCoarse = fi === 0 || (m - a) % coarse === 0
        ticks.push({ n, m, log: n + Math.log10(m / 1000), alpha: isCoarse ? 1 : fineAlpha, coarse: isCoarse, label: false })
      }
    }
  }

  placeLabels(ticks, k, labelGap)
  return ticks
}

// Landmarks that may be labelled on their own; any other label needs its whole grid to fit,
// which keeps stray in-betweens like ¥850 off the ruler.
const LANDMARKS = new Set([1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 7000])
const LABEL_STEPS = [1000, 500, 100, 50, 10, 5, 1]

function gridFits(m, k, gap) {
  const s = LABEL_STEPS.find((step) => m % step === 0)
  return k * Math.log10(m / (m - s)) >= gap
}

// Greedy: label the nicest numbers first, skipping any that would crowd a label already placed.
function placeLabels(ticks, k, gap) {
  const candidates = ticks
    .filter((t) => t.alpha > 0.99 && (LANDMARKS.has(t.m) || gridFits(t.m, k, gap)))
    .sort((p, q) => rank(p.m) - rank(q.m) || p.log - q.log)
  const placed = []
  for (const t of candidates) {
    const y = t.log * k
    let lo = 0
    let hi = placed.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (placed[mid] < y) lo = mid + 1
      else hi = mid
    }
    if (lo > 0 && y - placed[lo - 1] < gap) continue
    if (lo < placed.length && placed[lo] - y < gap) continue
    placed.splice(lo, 0, y)
    t.label = true
  }
}

// ---------- numbers

const formatters = new Map()
function num(decimals) {
  if (!formatters.has(decimals)) {
    formatters.set(decimals, new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }))
  }
  return formatters.get(decimals)
}

function trailingZeros(m) {
  let z = 0
  while (z < 3 && m % 10 === 0) {
    m /= 10
    z++
  }
  return z
}

export const tickValue = (m, n) => m * 10 ** (n - 3)

// Size of the last significant digit, e.g. ¥2,500 → 100, $1.50 → 0.1.
export const tickStep = (m, n) => 10 ** (n - 3 + trailingZeros(m))

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

export function tickLabel(m, n, cur) {
  if (n >= 6) return cur.symbol + compact.format(tickValue(m, n)) // ₩1M, ₩2.5B
  let d = Math.max(0, 3 - n - trailingZeros(m))
  if (d === 1 && cur.minor === 2) d = 2 // $1.50, not $1.5
  return cur.symbol + num(d).format(tickValue(m, n))
}

/** A reading. `step` is the precision it was snapped to, if any. */
export function formatAmount(v, cur, step) {
  if (!(v > 0) || !Number.isFinite(v)) return ''
  let d
  if (step) {
    d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
    if (d === 1 && cur.minor === 2) d = 2
  } else {
    const sig = Math.max(0, 1 - Math.floor(Math.log10(v)))
    d = cur.minor === 0 ? (v < 10 ? sig : 0) : Math.max(cur.minor, sig)
  }
  return cur.symbol + num(Math.min(d, 8)).format(v)
}

const rateDecimals = (x) => (x >= 10000 ? 0 : Math.min(6, Math.max(2, 3 - Math.floor(Math.log10(x)))))
export const formatRate = (x) => num(rateDecimals(x)).format(x)

export function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x))
  const f = x / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

const MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9, 천: 1e3, 만: 1e4, 억: 1e8 }

/** Accepts "3,450", "¥3450", "3.2k", "5만". Returns NaN when it can't read a positive amount. */
export function parseAmount(text, symbol = '') {
  let s = String(text)
  if (symbol) s = s.split(symbol).join('')
  s = s
    .replace(/[\s,_$¥₩€£฿≈~]/g, '')
    .replace(/^[a-z]{1,3}(?=[\d.])/i, '')
    .toLowerCase()
  const match = s.match(/^(\d+(?:\.\d*)?|\.\d+)([kmb천만억])?$/)
  if (!match) return NaN
  const v = parseFloat(match[1]) * (match[2] ? MULTIPLIERS[match[2]] : 1)
  return v > 0 ? v : NaN
}
