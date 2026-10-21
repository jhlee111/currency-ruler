import { CURRENCIES, SNAPSHOT } from './currencies.js'
import { loadCachedRates, fetchRates, marketDue } from './rates.js'
import { searchCurrencies, BY_NAME } from './search.js'
import { THEMES, isTheme, resolveTheme } from './themes.js'
import { setupInstall } from './install.js'
import { buildTicks, tickLabel, tickStep, formatAmount, formatRate, parseAmount, niceStep } from './scale.js'

// Coordinates: the ruler is a log10 axis of the left-hand currency (A), small at the top.
// The right-hand currency (B) is offset by R = log10(A per 1 B), so a B amount with
// log value lb sits where A's log value is lb + R.
//
// The reading line never moves: it sits across the middle of the ruler, and the scale
// slides underneath it. So the view is just the reading plus how much of the scale shows.

const $ = (id) => document.getElementById(id)
const els = {
  status: $('status'),
  statusText: $('status-text'),
  nameA: $('name-a'),
  nameB: $('name-b'),
  pickA: $('pick-a'),
  pickB: $('pick-b'),
  picker: $('picker'),
  pickerTitle: $('picker-title'),
  pickerQ: $('picker-q'),
  pickerList: $('picker-list'),
  credit: $('credit'),
  rateCredit: $('rate-credit'),
  amtA: $('amt-a'),
  amtB: $('amt-b'),
  swap: $('swap'),
  ruler: $('ruler'),
  canvas: $('canvas'),
  glass: $('glass'),
  live: $('live'),
  openSettings: $('open-settings'),
  settings: $('settings'),
  optMiddle: $('opt-middle'),
  themeOptions: $('theme-options'),
  themeColor: $('theme-color'),
  rateSheet: $('rate-sheet'),
  rateBig: $('rate-big'),
  rateSource: $('rate-source'),
  rateChecked: $('rate-checked'),
  rateCheck: $('rate-check'),
}
const ctx = els.canvas.getContext('2d')

const MIN_SPAN = 0.04 // decades on screen, fully zoomed in
const MAX_SPAN = 7
const HOME_SPAN = 3.2 // how much shows when the app opens, and after a double tap
const ZERO_GAP = 0.4 // decades of ruler between 0 and the smallest coin, spaced linearly
const ENDLESS = 15 // the bottom of the scale: 10^15 is as good as endless, and still exact in a double
const MAGNET = 10 // px within which a settling reading catches on a labelled tick, at most…
const MAGNET_SHARE = Math.log10(1.025) // …and never more than ±2.5% of the amount
const FRICTION = 0.995 // a fling keeps this share of its speed each millisecond
const FLICK = 0.25 // px/ms; slower releases just settle where they are
const MAX_FLING = 3 // px/ms; even a hard flick glides a few decades, not off the end of the scale
const TAP_SLOP = 6 // px a finger may wander and still count as a tap
const DOUBLE_TAP_MS = 320
const REFRESH_AFTER = 30 * 60 * 1000 // re-check the rate when the app returns after this long
const FONT = '"B612", ui-sans-serif, system-ui, sans-serif'
const PREFS_KEY = 'currency-ruler:prefs'

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
const finePointer = matchMedia('(hover: hover) and (pointer: fine)')
const darkScheme = matchMedia('(prefers-color-scheme: dark)')

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const lerp = (a, b, t) => a + (b - a) * t
const easeOutCubic = (t) => 1 - (1 - t) ** 3

// ---------- state

const prefs = loadPrefs()
const cachedEcb = loadCachedRates('ecb')
const cachedMarket = loadCachedRates('market')

const state = {
  a: prefs?.a ?? 'JPY',
  b: prefs?.b ?? 'USD',
  // Units per 1 USD from each source. The market source has nothing until its first fetch.
  sources: {
    ecb: { ...cachedEcb, date: cachedEcb?.date ?? SNAPSHOT.date, rates: { ...SNAPSHOT.rates, ...cachedEcb?.rates } },
    market: cachedMarket,
  },
  status: { ecb: 'loading', market: cachedMarket && !marketDue(cachedMarket) ? 'live' : 'loading' }, // loading | live | saved
  checks: {
    // The latest attempt to fetch each source.
    ecb: cachedEcb?.fetchedAt ? { at: cachedEcb.fetchedAt, ok: true } : null,
    market: cachedMarket?.fetchedAt ? { at: cachedMarket.fetchedAt, ok: true } : null,
  },
  recent: (prefs?.recent ?? []).filter((code) => CURRENCIES[code]).slice(0, 6),
  R: 0, // animated toward liveR() when a new rate arrives
  cursor: validCursor(prefs?.cursor), // the reading on the line
  span: Number.isFinite(prefs?.span) ? clamp(prefs.span, MIN_SPAN, MAX_SPAN) : HOME_SPAN,
  layout: prefs?.layout === 'middle' ? 'middle' : 'edges', // where the ticks start
  theme: isTheme(prefs?.theme) ? prefs.theme : 'system',
  editing: null, // 'a' | 'b' while an amount field has focus
  checking: false,
}
// A saved pair whose rates aren't on this device (say, storage was cleared) starts over.
if (!canPair(state.a, state.b)) Object.assign(state, { a: 'JPY', b: 'USD', cursor: null })
state.R = liveR()
state.cursor ??= home()

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')
    if (p && CURRENCIES[p.a] && CURRENCIES[p.b] && p.a !== p.b) return p
  } catch {}
  return null
}

function validCursor(c) {
  const pos = c?.pos ?? c?.log // saved before 0 joined the ruler, when a position was just a log
  if (c && (c.side === 'a' || c.side === 'b') && Number.isFinite(pos)) return { side: c.side, pos, step: c.step > 0 ? c.step : null }
  return null
}

let saveTimer = 0
function savePrefs() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ a: state.a, b: state.b, cursor: state.cursor, span: state.span, layout: state.layout, theme: state.theme, recent: state.recent }),
      )
    } catch {}
  }, 300)
}

// A pair is priced by the ECB when it covers both currencies, otherwise by the market source,
// so the two numbers always come from the same place and the same day.
function sourceFor(a = state.a, b = state.b) {
  const ecb = state.sources.ecb.rates
  return ecb[a] && ecb[b] ? 'ecb' : 'market'
}
function ratesFor(a, b) {
  return state.sources[sourceFor(a, b)]?.rates ?? null
}
function canPair(a, b) {
  const rates = ratesFor(a, b)
  return Boolean(rates?.[a] && rates?.[b])
}
function unitsPerUsd(code) {
  return state.sources.ecb.rates[code] ?? state.sources.market?.rates[code] ?? NaN
}
function liveR() {
  const rates = ratesFor(state.a, state.b)
  return Math.log10(rates[state.a] / rates[state.b])
}

const readingPosA = (c) => (c.side === 'a' ? c.pos : c.pos + state.R)
const cursorPosA = () => readingPosA(state.cursor)
const kNow = () => size.h / state.span
const viewLo = () => cursorPosA() - state.span / 2

// Where the ruler opens and where a double tap returns: a typical price in the pair's smaller
// unit (¥1,000, ₩10,000). Basing it on the pair rather than the left side survives a swap.
function home() {
  const code = unitsPerUsd(state.a) >= unitsPerUsd(state.b) ? state.a : state.b
  return { side: code === state.a ? 'a' : 'b', pos: Math.round(Math.log10(unitsPerUsd(code))) + 1, step: null }
}

// ---------- positions on the ruler
//
// A position is in decades. From the smaller of the two smallest coins up (¥1 against $0.01
// → ¥1) it is simply log10 of the amount, so the right-hand scale is the left-hand one shifted
// by R. A log scale never reaches 0, so below that coin a short linear stretch carries the
// smaller amounts down to 0. The coin is the same value on both sides, so the shift by R
// holds on that stretch too.

const smallestLog = (code) => -CURRENCIES[code].minor // ¥1 → 0, $0.01 → -2
const coinPos = () => Math.min(smallestLog(state.a), smallestLog(state.b) + state.R) // in A's space
const zeroPos = () => coinPos() - ZERO_GAP // in A's space; the top end of the ruler
const shift = (side) => (side === 'a' ? 0 : state.R)

function valueAt(pos, side) {
  const coin = coinPos() - shift(side)
  if (pos >= coin) return 10 ** pos
  const share = (pos - coin + ZERO_GAP) / ZERO_GAP
  // Shifting by R and back leaves a rounding hair above 0; 0 should read as 0 on both sides.
  return share < 1e-9 ? 0 : 10 ** coin * share
}

function posOf(value, side) {
  const coin = coinPos() - shift(side)
  if (value >= 10 ** coin) return Math.log10(value)
  return coin - ZERO_GAP + (ZERO_GAP * value) / 10 ** coin
}

// What one pixel is worth at a position, for rounding a reading to what the eye can resolve.
function perPixel(pos, side) {
  const coin = coinPos() - shift(side)
  return (pos >= coin ? 10 ** pos * Math.LN10 : 10 ** coin / ZERO_GAP) / kNow()
}

// 0 can be pulled down to the line; below, the scale runs on and on.
function scrollLimit(from, to) {
  return clamp(to, Math.min(zeroPos(), from), Math.max(ENDLESS, from))
}

// ---------- animation

function tween(duration, ease, step, done) {
  const handle = { cancel() {} }
  if (reduceMotion.matches || duration <= 0) {
    step(1)
    requestRender()
    done?.()
    return handle
  }
  let raf = 0
  const start = performance.now()
  const frame = (now) => {
    const t = Math.min(1, (now - start) / duration)
    step(ease(t))
    requestRender()
    if (t < 1) raf = requestAnimationFrame(frame)
    else done?.()
  }
  raf = requestAnimationFrame(frame)
  handle.cancel = () => cancelAnimationFrame(raf)
  return handle
}

let rateTween = null
function animateR(to, duration = 450) {
  rateTween?.cancel()
  const from = state.R
  rateTween = tween(duration, easeOutCubic, (e) => (state.R = lerp(from, to, e)), () => (rateTween = null))
}
function settleR() {
  rateTween?.cancel()
  rateTween = null
  state.R = liveR()
}

// ---------- size & paint

const size = { w: 0, h: 0, dpr: 1 }
let M = metricsFor(410)
let colors = readColors()
let frame = { labelsA: [], labelsB: [] }

function metricsFor(w) {
  const u = clamp(w / 410, 0.8, 1.1)
  return {
    decade: 66 * u,
    major: 48 * u,
    label: 34 * u,
    mid: 21 * u,
    minor: 12 * u,
    labelX: 82 * u,
    fs: Math.max(13, 15 * u),
    fsBig: Math.max(16, 19 * u),
  }
}

function readColors() {
  const cs = getComputedStyle(document.documentElement)
  const v = (name) => cs.getPropertyValue(name).trim()
  return { tick: v('--tick'), ink: v('--scale-ink'), inkSoft: v('--scale-ink-soft'), paper: v('--paper'), edge: v('--ruler-edge') }
}

new ResizeObserver(onResize).observe(els.ruler)

function onResize() {
  const w = els.canvas.clientWidth
  const h = els.canvas.clientHeight
  if (!w || !h) return
  const dpr = window.devicePixelRatio || 1
  Object.assign(size, { w, h, dpr })
  els.canvas.width = Math.round(w * dpr)
  els.canvas.height = Math.round(h * dpr)
  M = metricsFor(w)
  els.ruler.style.setProperty('--label-x', `${M.labelX}px`)
  render()
}

let queued = false
function requestRender() {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    render()
  })
}

function render() {
  if (!size.h) return
  draw()
  renderDom()
}

function draw() {
  const lo = viewLo()
  const hi = lo + state.span
  const k = kNow()
  const gap = M.fs * 2.05
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height)

  const ticksA = scaleTicks('a', lo, hi, k, gap)
  const ticksB = scaleTicks('b', lo - state.R, hi - state.R, k, gap)
  drawRulerStart(lo, k) // first, so nothing drawn near the end is painted over
  if (state.layout === 'middle') drawSpine()
  drawSide(ticksA, 0, false, CURRENCIES[state.a], k, lo)
  drawSide(ticksB, state.R, true, CURRENCIES[state.b], k, lo)
  frame = { labelsA: ticksA.filter((t) => t.label), labelsB: ticksB.filter((t) => t.label) }
}

// One side's ticks: a 0 at the top end, evenly spaced amounts on the linear stretch up to the
// coin, then the log scale from the coin on. `log` is always the tick's position.
function scaleTicks(side, lo, hi, k, gap) {
  const coin = coinPos() - shift(side)
  const ticks = [{ zero: true, m: 1000, log: coin - ZERO_GAP, alpha: 1, coarse: true, label: true, step: 1 }]
  if (lo < coin) ticks.push(...linearTicks(side, k, gap))
  if (hi > coin) ticks.push(...buildTicks(Math.max(lo, coin), hi, k, gap).filter((t) => t.log >= coin - 1e-9))
  return ticks
}

// The smallest of 1, 2, 5 × 10ⁿ that is at least x, so spacing never comes out tighter than asked.
function niceAtLeast(x) {
  const p = 10 ** Math.floor(Math.log10(x))
  const f = x / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p
}

// Between 0 and the coin, amounts are evenly spaced: ticks at least 6px apart, labels a label apart.
function linearTicks(side, k, gap) {
  const coin = 10 ** (coinPos() - shift(side)) // in this side's units
  const pxPerUnit = (ZERO_GAP * k) / coin
  const minor = niceAtLeast(6 / pxPerUnit)
  const major = niceAtLeast(gap / pxPerUnit)
  const ticks = []
  for (let i = 1; i * minor < coin * (1 - 1e-9); i++) {
    const value = i * minor
    const label = Math.abs(value / major - Math.round(value / major)) < 1e-6
    ticks.push({ linear: true, value, log: posOf(value, side), alpha: 1, coarse: label, label, step: major })
  }
  return ticks
}

const tickText = (t, cur) => (t.zero ? `${cur.symbol}0` : t.linear ? formatAmount(t.value, cur, t.step) : tickLabel(t.m, t.n, cur))

// Edges: ticks hang in from the sides with the amounts inside them.
// Middle: ticks grow out from the centre line with the amounts outside them.
function drawSide(ticks, offset, right, cur, k, lo) {
  const { w, h, dpr } = size
  const middle = state.layout === 'middle'
  const origin = middle ? w / 2 : right ? w : 0
  const dir = (right ? -1 : 1) * (middle ? -1 : 1)
  ctx.strokeStyle = colors.tick
  for (const t of ticks) {
    const y = (t.log + offset - lo) * k
    if (y < -4 || y > h + 4) continue
    const kind = t.m === 1000 ? 'decade' : t.m === 2000 || t.m === 5000 ? 'major' : t.label ? 'label' : t.coarse ? 'mid' : 'minor'
    const lw = Math.max(1, Math.round((kind === 'decade' ? 2 : kind === 'major' ? 1.5 : 1) * dpr))
    const yd = Math.round(y * dpr) + (lw % 2 ? 0.5 : 0)
    ctx.globalAlpha = t.alpha
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(origin * dpr, yd)
    ctx.lineTo((origin + dir * M[kind]) * dpr, yd)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.textAlign = dir > 0 ? 'left' : 'right'
  ctx.textBaseline = 'middle'
  const x = (origin + dir * M.labelX) * dpr
  for (const t of ticks) {
    if (!t.label) continue
    const big = t.m === 1000
    const fs = big ? M.fsBig : M.fs
    // 0 sits on the very end of the ruler, so its label goes just inside rather than across the edge.
    const y = (t.log + offset - lo) * k + (t.zero ? fs * 0.8 : 0.5)
    if (y < -30 || y > h + 30) continue
    if (Math.abs(y - h / 2) < 27) continue // under the reading line's band; its pills show the amount
    ctx.font = `${big ? 700 : 400} ${fs * dpr}px ${FONT}`
    ctx.fillStyle = big ? colors.ink : colors.inkSoft
    ctx.fillText(tickText(t, cur), x, y * dpr)
  }
}

// Above 0 the ruler simply ends: the page shows through, edged like the end of a stick.
function drawRulerStart(lo, k) {
  const { w, dpr } = size
  const y = (zeroPos() - lo) * k
  if (y <= 0) return
  const yd = Math.round(y * dpr)
  ctx.fillStyle = colors.paper
  ctx.fillRect(0, 0, w * dpr, yd)
  ctx.fillStyle = colors.edge
  ctx.fillRect(0, yd - Math.max(1, Math.round(dpr)), w * dpr, Math.max(1, Math.round(dpr)))
}

function drawSpine() {
  const { w, h, dpr } = size
  const lw = Math.max(1, Math.round(1.5 * dpr))
  ctx.fillStyle = colors.tick
  ctx.fillRect(Math.round((w / 2) * dpr - lw / 2), 0, lw, h * dpr)
}

// ---------- DOM

const setText = (el, text) => {
  if (el.textContent !== text) el.textContent = text
}
const setValue = (el, text) => {
  if (el.value !== text) el.value = text
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fmtDate = (iso) => dateFormat.format(new Date(`${iso}T00:00:00Z`))

function readings() {
  const A = CURRENCIES[state.a]
  const B = CURRENCIES[state.b]
  const c = state.cursor
  const pa = cursorPosA()
  return {
    a: formatAmount(valueAt(pa, 'a'), A, c.side === 'a' ? c.step : null),
    b: formatAmount(valueAt(pa - state.R, 'b'), B, c.side === 'b' ? c.step : null),
  }
}

// The amounts on the line are inputs sized to what they hold.
function fitPill(input) {
  input.style.width = `calc(${Math.max(4, input.value.length + 1)}ch + 20px)`
}

let announceTimer = 0
function renderDom() {
  const r = readings()
  if (state.editing !== 'a') setValue(els.amtA, r.a)
  if (state.editing !== 'b') setValue(els.amtB, r.b)
  fitPill(els.amtA)
  fitPill(els.amtB)
  renderStatus()
  clearTimeout(announceTimer)
  announceTimer = setTimeout(() => setText(els.live, `${r.a} is ${r.b}`), 600)
}

// Reads in the ruler's own order: left-hand currency first, and 1 of whichever is worth more.
function rateText() {
  const A = CURRENCIES[state.a]
  const B = CURRENCIES[state.b]
  const x = formatRate(10 ** Math.abs(state.R))
  return state.R >= 0 ? `${A.symbol}${x} = ${B.symbol}1` : `${A.symbol}1 = ${B.symbol}${x}`
}

function renderStatus() {
  const src = sourceFor()
  const { date } = state.sources[src]
  let tone
  let text
  if (state.status[src] === 'live') {
    tone = 'live'
    text = `${src === 'ecb' ? 'ECB' : 'Market'} rate, ${fmtDate(date)}`
  } else if (state.status[src] === 'loading') {
    tone = 'muted'
    text = 'Checking today’s rate'
  } else {
    tone = 'saved'
    text = `Saved rate from ${fmtDate(date)}`
  }
  els.status.dataset.tone = tone
  setText(els.statusText, text)
  els.status.setAttribute('aria-label', `${text}. Show rate details`)
  // ExchangeRate-API's terms ask for a visible credit wherever its rates are shown.
  els.credit.hidden = src !== 'market'
  renderRateSheet()
}

const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const localDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
function ago(t) {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `on ${localDate.format(new Date(t))}`
}

function renderRateSheet() {
  if (!els.rateSheet.open) return
  const src = sourceFor()
  const day = longDate.format(new Date(`${state.sources[src].date}T00:00:00Z`))
  setText(els.rateBig, rateText())
  setText(
    els.rateSource,
    src === 'ecb'
      ? `European Central Bank reference rate for ${day}. A new one is published each working day.`
      : `Mid-market rate for ${day}. A new one comes out once a day.`,
  )
  els.rateCredit.hidden = src !== 'market'
  const last = state.checks[src]
  let text
  if (state.checking) text = 'Checking for a newer rate…'
  else if (!last) text = 'Not checked yet.'
  else if (last.ok) text = `Checked ${ago(last.at)}.`
  else text = `Couldn’t reach the rate service ${ago(last.at)}. Showing the rate saved on this device.`
  setText(els.rateChecked, text)
  els.rateChecked.dataset.tone = state.checking ? 'muted' : last?.ok ? 'live' : 'saved'
  els.rateCheck.disabled = state.checking
  setText(els.rateCheck, state.checking ? 'Checking…' : 'Check again')
}

function syncCurrencyUi() {
  const A = CURRENCIES[state.a]
  const B = CURRENCIES[state.b]
  setText(els.nameA, A.short)
  setText(els.nameB, B.short)
  els.pickA.setAttribute('aria-label', `Left-hand currency: ${A.name}. Change`)
  els.pickB.setAttribute('aria-label', `Right-hand currency: ${B.name}. Change`)
  els.amtA.setAttribute('aria-label', `Amount in ${A.name}`)
  els.amtB.setAttribute('aria-label', `Amount in ${B.name}`)
}

// ---------- moving the scale

// One motion at a time: a fling in flight or a glide toward a typed amount.
let glide = 0
let motion = null
function stopMotion() {
  cancelAnimationFrame(glide)
  glide = 0
  motion?.cancel()
  motion = null
}

// Slide the scale by dy px (positive = finger moving down, so smaller amounts come to the line).
// Readings follow the left-hand currency at about a pixel's precision. Returns false at a limit.
function scrollBy(dy, pointerType) {
  const k = kNow()
  const from = cursorPosA()
  const wanted = from - dy / k
  const to = scrollLimit(from, wanted)
  state.cursor = { side: 'a', pos: to, step: niceStep(perPixel(to, 'a')) }
  clickPast(from, to, pointerType)
  requestRender()
  return to === wanted
}

// A short buzz each time a labelled tick crosses the line, like the detents of a dial.
let lastClick = 0
function clickPast(from, to, pointerType) {
  if (pointerType !== 'touch' || !navigator.vibrate) return
  const [lo, hi] = from < to ? [from, to] : [to, from]
  const now = performance.now()
  if (now - lastClick > 35 && frame.labelsA.some((t) => t.log > lo && t.log <= hi)) {
    lastClick = now
    navigator.vibrate(3)
  }
}

// Where a reading at posA comes to rest: on a labelled tick if one is close, otherwise on a
// tidy amount for the current zoom (¥1,200 rather than ¥1,197).
function restingPlace(posA) {
  const k = kNow()
  let best = null
  let bestDist = Math.min(MAGNET, k * MAGNET_SHARE)
  for (const t of frame.labelsA) {
    const d = Math.abs(t.log - posA) * k
    if (d < bestDist) {
      bestDist = d
      best = t
    }
  }
  if (best) return { side: 'a', pos: best.log, step: best.step ?? tickStep(best.m, best.n) }
  const step = niceStep(perPixel(posA, 'a') * 4)
  const value = Math.max(0, Math.round(valueAt(posA, 'a') / step) * step)
  return { side: 'a', pos: posOf(value, 'a'), step }
}

// Glide the scale so `to` sits on the line, then hold it there exactly.
function glideTo(to, duration = 200) {
  stopMotion()
  const from = cursorPosA()
  const target = readingPosA(to)
  if (Math.abs(target - from) * kNow() < 0.5) duration = 0
  motion = tween(duration, easeOutCubic, (e) => {
    const pos = lerp(from, target, e)
    state.cursor = { side: 'a', pos, step: niceStep(perPixel(pos, 'a')) }
  }, () => {
    state.cursor = to
    motion = null
    savePrefs()
  })
}

function settle() {
  glideTo(restingPlace(cursorPosA()), 160)
}

function fling(velocity, pointerType) {
  let v = velocity
  let last = performance.now()
  const step = (now) => {
    const dt = Math.min(48, now - last)
    last = now
    const free = scrollBy(v * dt, pointerType)
    v *= FRICTION ** dt
    if (!free || Math.abs(v) < 0.03) {
      glide = 0
      settle()
      return
    }
    glide = requestAnimationFrame(step)
  }
  glide = requestAnimationFrame(step)
}

function zoomTo(span, duration = 0) {
  const from = state.span
  const to = clamp(span, MIN_SPAN, MAX_SPAN)
  if (!duration) {
    state.span = to
    requestRender()
    return
  }
  tween(duration, easeOutCubic, (e) => (state.span = lerp(from, to, e)), savePrefs)
}

// Back to how the app opens: the usual zoom, a typical price on the line.
function resetView() {
  stopMotion()
  const fromSpan = state.span
  const fromPos = cursorPosA()
  const to = home()
  const target = readingPosA(to)
  motion = tween(320, easeOutCubic, (e) => {
    state.span = lerp(fromSpan, HOME_SPAN, e)
    const pos = lerp(fromPos, target, e)
    state.cursor = { side: 'a', pos, step: niceStep(perPixel(pos, 'a')) }
  }, () => {
    state.cursor = to
    motion = null
    savePrefs()
  })
}

// Step the reading on `side` to the next tidy amount, no lower than 0.
function stepReading(side, dir, big) {
  const pos = side === 'a' ? cursorPosA() : cursorPosA() - state.R
  const v = valueAt(pos, side)
  const step = niceStep(perPixel(pos, side) * (big ? 30 : 4))
  const next = Math.max(0, (Math.round(v / step) + dir) * step)
  glideTo({ side, pos: posOf(next, side), step }, 120)
  return { next, step }
}

function nudge(dir, big) {
  stepReading(state.cursor.side, dir, big)
}

// ---------- touch, mouse, wheel, keyboard

const pointers = new Map()
let gesture = null
let tapFocus = null // a field to open once the tap that pressed it completes
let lastTap = null

function localPoint(e) {
  const r = els.canvas.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

const within = (e, el, padX, padY) => {
  const b = el.getBoundingClientRect()
  return e.clientX >= b.left - padX && e.clientX <= b.right + padX && e.clientY >= b.top - padY && e.clientY <= b.bottom + padY
}

// A tap on an amount on the line opens it for typing.
function pillAt(e) {
  if (within(e, els.amtA, 6, 8)) return els.amtA
  if (within(e, els.amtB, 6, 8)) return els.amtB
  return null
}

const spread = (p1, p2) => Math.max(24, Math.hypot(p1.x - p2.x, p1.y - p2.y))

els.ruler.addEventListener('pointerdown', (e) => {
  if (!size.h || (e.pointerType === 'mouse' && e.button !== 0)) return
  if (e.target.classList.contains('editing')) return // placing the caret in an amount being typed
  const p = localPoint(e)
  pointers.set(e.pointerId, p)
  try {
    els.ruler.setPointerCapture(e.pointerId)
  } catch {} // a pointer the browser no longer tracks can't be captured; the drag still works
  stopMotion()
  tapFocus = null
  if (pointers.size === 1) {
    gesture = { type: 'scroll', start: p, lastY: p.y, moved: false, track: [[performance.now(), p.y]], field: pillAt(e), pointerType: e.pointerType }
  } else if (pointers.size === 2) {
    // Pinching zooms around the line; the reading stays put.
    const [p1, p2] = [...pointers.values()]
    gesture = { type: 'pinch', d0: spread(p1, p2), span0: state.span }
  }
})

els.ruler.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return
  const p = localPoint(e)
  pointers.set(e.pointerId, p)
  const g = gesture
  if (g?.type === 'scroll') {
    if (!g.moved && Math.abs(p.y - g.start.y) > TAP_SLOP) {
      g.moved = true
      els.ruler.classList.add('dragging')
    }
    if (!g.moved) return
    scrollBy(p.y - g.lastY, g.pointerType)
    g.lastY = p.y
    const now = performance.now()
    g.track.push([now, p.y])
    while (g.track.length > 2 && now - g.track[0][0] > 100) g.track.shift()
  } else if (g?.type === 'pinch' && pointers.size >= 2) {
    const [p1, p2] = [...pointers.values()]
    zoomTo((g.span0 * g.d0) / spread(p1, p2))
  }
})

function endPointer(e) {
  if (!pointers.delete(e.pointerId)) return
  if (pointers.size > 0) {
    // One finger of a pinch lifted: ignore the other until it lifts too.
    if (gesture?.type === 'pinch') gesture = { type: 'idle' }
    return
  }
  const g = gesture
  gesture = null
  els.ruler.classList.remove('dragging')
  if (g?.type !== 'scroll') {
    savePrefs()
    return
  }
  if (!g.moved) {
    if (e.type === 'pointerup') tap(g, e)
    return
  }
  // A finger that came to rest before lifting releases nothing; otherwise use its last 100ms.
  const [t0, y0] = g.track[0]
  const [t1, y1] = g.track[g.track.length - 1]
  const still = performance.now() - t1 > 60
  const v = !still && t1 - t0 > 10 ? (y1 - y0) / (t1 - t0) : 0
  if (e.type === 'pointerup' && Math.abs(v) > FLICK && !reduceMotion.matches) fling(clamp(v, -MAX_FLING, MAX_FLING), g.pointerType)
  else settle()
}
els.ruler.addEventListener('pointerup', endPointer)
els.ruler.addEventListener('pointercancel', endPointer)

// A tap on a pill opens it for typing; two quick taps anywhere else reset the ruler.
function tap(g, e) {
  if (g.field) {
    tapFocus = g.field
    lastTap = null
    return
  }
  const now = performance.now()
  if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
    lastTap = null
    resetView()
  } else {
    lastTap = { t: now, x: e.clientX, y: e.clientY }
  }
}

// Focus from the click that follows the tap, so phones open the keyboard.
els.ruler.addEventListener('click', () => {
  const field = tapFocus
  tapFocus = null
  field?.focus()
})

// Desktop: scroll slides the scale, pinch or Ctrl-scroll zooms around the line.
let wheelSettle = 0
els.ruler.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    if (!size.h) return
    stopMotion()
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1
    if (e.ctrlKey || e.metaKey) {
      if (safariPinch) return
      zoomTo(state.span * Math.exp(clamp(e.deltaY * unit, -60, 60) * 0.01))
    } else {
      scrollBy(-e.deltaY * unit, 'wheel')
      clearTimeout(wheelSettle)
      wheelSettle = setTimeout(settle, 180)
    }
  },
  { passive: false },
)

// Safari reports trackpad pinches as gesture events rather than ctrl-wheel.
let safariPinch = null
els.ruler.addEventListener('gesturestart', (e) => {
  e.preventDefault()
  if (pointers.size) return
  safariPinch = { span0: state.span }
})
els.ruler.addEventListener('gesturechange', (e) => {
  e.preventDefault()
  if (safariPinch && !pointers.size) zoomTo(safariPinch.span0 / e.scale)
})
els.ruler.addEventListener('gestureend', (e) => {
  e.preventDefault()
  safariPinch = null
  savePrefs()
})

els.ruler.addEventListener('keydown', (e) => {
  if (e.target !== els.ruler) return
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowDown':
      nudge(e.key === 'ArrowUp' ? -1 : 1, e.shiftKey)
      break
    case '+':
    case '=':
      zoomTo(state.span / 2, 200)
      break
    case '-':
    case '_':
      zoomTo(state.span * 2, 200)
      break
    case '0':
      resetView()
      break
    default:
      return
  }
  e.preventDefault()
})

// iOS often ignores select() on focus, which makes typing add to the old amount.
function selectAll(input) {
  input.select()
  setTimeout(() => {
    if (document.activeElement === input) input.setSelectionRange(0, input.value.length)
  }, 0)
}

// ---------- converter fields

for (const [side, input] of [['a', els.amtA], ['b', els.amtB]]) {
  input.addEventListener('focus', () => {
    state.editing = side
    input.classList.add('editing')
    selectAll(input)
  })
  input.addEventListener('blur', () => {
    state.editing = null
    input.classList.remove('editing')
    input.removeAttribute('aria-invalid')
    render()
  })
  // The typed amount glides onto the line as you type.
  input.addEventListener('input', () => {
    if (!input.value.trim()) return input.removeAttribute('aria-invalid')
    const v = parseAmount(input.value, CURRENCIES[state[side]].symbol)
    if (!Number.isFinite(v)) return input.setAttribute('aria-invalid', 'true')
    input.removeAttribute('aria-invalid')
    glideTo({ side, pos: posOf(v, side), step: null })
    fitPill(input)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') input.blur()
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const { next, step } = stepReading(side, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
      input.value = formatAmount(next, CURRENCIES[state[side]], step)
    }
  })
}

// ---------- currencies

els.swap.addEventListener('click', swapSides)

function setCurrency(which, code) {
  const other = which === 'a' ? 'b' : 'a'
  if (code === state[which]) return
  if (code === state[other]) {
    syncCurrencyUi()
    return swapSides()
  }
  if (!canPair(which === 'a' ? code : state.a, which === 'b' ? code : state.b)) return
  // Keep the amount on the unchanged side; the changed side re-reads against it.
  const pa = cursorPosA()
  const keep = valueAt(other === 'a' ? pa : pa - state.R, other)
  const step = state.cursor.side === other ? state.cursor.step : null
  stopMotion()
  state[which] = code
  settleR()
  state.cursor = { side: other, pos: posOf(keep, other), step }
  syncCurrencyUi()
  savePrefs()
  requestRender()
  if (!reduceMotion.matches) els.canvas.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' })
}

let flipping = false
async function swapSides() {
  if (flipping) return
  els.swap.classList.toggle('turned')
  if (reduceMotion.matches || !els.ruler.animate) {
    applySwap()
    return
  }
  flipping = true
  const turn = (from, to, duration, easing) =>
    els.ruler.animate([{ transform: `perspective(1400px) rotateY(${from}deg)` }, { transform: `perspective(1400px) rotateY(${to}deg)` }], { duration, easing }).finished
  await turn(0, 90, 140, 'ease-in')
  applySwap()
  render()
  await turn(-90, 0, 220, 'cubic-bezier(.2,.8,.3,1)')
  flipping = false
}

// The picture stays put: the same amounts sit at the same heights, only the sides trade places.
function applySwap() {
  stopMotion()
  settleR()
  const R = state.R
  ;[state.a, state.b] = [state.b, state.a]
  state.R = -R
  state.cursor = { ...state.cursor, side: state.cursor.side === 'a' ? 'b' : 'a' }
  syncCurrencyUi()
  savePrefs()
  requestRender()
}

// ---------- currency picker

const PICKER_TITLES = { a: 'Left-hand currency', b: 'Right-hand currency' }
let pickerSide = 'a'

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const pairNumber = (v) => new Intl.NumberFormat('en-US', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 }).format(v)

// "₫25,858 = $1": the row's currency against the other side of the ruler, 1 of whichever is worth more.
function pairText(code, other) {
  const rates = ratesFor(code, other)
  const x = rates[code] / rates[other]
  const C = CURRENCIES[code].symbol
  const O = CURRENCIES[other].symbol
  return x >= 1 ? `${C}${pairNumber(x)} = ${O}1` : `${C}1 = ${O}${pairNumber(1 / x)}`
}

function pickerRow(code) {
  const here = state[pickerSide]
  const other = state[pickerSide === 'a' ? 'b' : 'a']
  const c = CURRENCIES[code]
  const usable = code === other || canPair(code, other)
  const symbol = c.symbol.trim() === code ? '' : ` · ${c.symbol.trim()}`
  const place = c.regionNames.length ? ` · ${c.regionNames[0]}${c.regionNames.length > 1 ? ` +${c.regionNames.length - 1}` : ''}` : ''
  // Without market rates on the device yet, most currencies wait for a connection; once they're
  // here, a currency still missing simply isn't offered by any source.
  const missing = state.sources.market ? 'No rate available' : 'Needs a connection'
  const right = code === here ? 'On the ruler' : code === other ? 'Swap sides' : usable ? pairText(code, other) : missing
  return `<li><button type="button" class="pick-row" data-code="${code}"${usable ? '' : ' disabled'}${code === here ? ' aria-current="true"' : ''}>
    <span class="pick-main"><span class="pick-name">${escapeHtml(c.name)}</span><span class="pick-sub">${escapeHtml(code + symbol + place)}</span></span>
    <span class="pick-rate">${escapeHtml(right)}</span></button></li>`
}

const pickerSection = (title, codes) => `<h3 class="pick-sec">${escapeHtml(title)}</h3><ul class="pick-list">${codes.map(pickerRow).join('')}</ul>`

function renderPicker() {
  const query = els.pickerQ.value.trim()
  const here = state[pickerSide]
  const other = state[pickerSide === 'a' ? 'b' : 'a']
  let html
  if (query) {
    const hits = searchCurrencies(query)
    html = hits.length
      ? pickerSection(`${hits.length} result${hits.length === 1 ? '' : 's'}`, hits)
      : `<div class="pick-empty"><p class="pick-name">No currency matches “${escapeHtml(query)}”</p><p class="pick-sub">Try a code like VND or a country like Vietnam.</p></div>`
  } else {
    const recent = state.recent.filter((code) => code !== here && code !== other)
    html = pickerSection('On the ruler', [here, other]) + (recent.length ? pickerSection('Recent', recent) : '') + pickerSection('All currencies', BY_NAME)
  }
  els.pickerList.innerHTML =
    html +
    `<p class="pick-foot">Rates come from the European Central Bank for 30 major currencies, and from <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a> for the rest.</p>`
}

function openPicker(side) {
  if (flipping) return // a swap is mid-turn; its sides aren't settled yet
  pickerSide = side
  setText(els.pickerTitle, PICKER_TITLES[side])
  els.pickerQ.value = ''
  renderPicker()
  els.picker.showModal()
  els.pickerList.scrollTop = 0
  // On a phone, keep the keyboard closed so the recent and listed currencies stay in view.
  if (finePointer.matches) els.pickerQ.focus()
}

function remember(code) {
  state.recent = [code, ...state.recent.filter((c) => c !== code)].slice(0, 6)
}

function choose(code) {
  const side = pickerSide
  els.picker.close()
  if (code === state[side]) return
  remember(state[side])
  remember(code)
  setCurrency(side, code)
  savePrefs()
}

els.pickA.addEventListener('click', () => openPicker('a'))
els.pickB.addEventListener('click', () => openPicker('b'))
els.pickerQ.addEventListener('input', () => {
  renderPicker()
  els.pickerList.scrollTop = 0
})
els.pickerQ.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    const first = els.pickerList.querySelector('.pick-row:not([disabled])')
    if (first && els.pickerQ.value.trim()) choose(first.dataset.code)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    els.pickerList.querySelector('.pick-row:not([disabled])')?.focus()
  }
})
els.pickerList.addEventListener('click', (e) => {
  const row = e.target.closest('.pick-row')
  if (row && !row.disabled) choose(row.dataset.code)
})

// ---------- rates

function load(kind) {
  return fetchRates(kind)
    .then((data) => {
      state.sources[kind] = kind === 'ecb' ? { ...data, rates: { ...SNAPSHOT.rates, ...data.rates } } : data
      state.status[kind] = 'live'
      state.checks[kind] = { at: Date.now(), ok: true }
    })
    .catch(() => {
      // Any failed check means the rate on screen can't be vouched for, even if an earlier one worked.
      state.status[kind] = 'saved'
      state.checks[kind] = { at: Date.now(), ok: false }
    })
}

let lastFetch = 0
function refreshRates() {
  if (state.checking) return
  state.checking = true
  lastFetch = Date.now()
  renderRateSheet()
  const jobs = [load('ecb')]
  // The market source asks for at most one request an hour, so it's only called when due.
  if (marketDue(state.sources.market)) jobs.push(load('market'))
  Promise.all(jobs).then(() => {
    state.checking = false
    if (Math.abs(liveR() - state.R) > 1e-9) animateR(liveR())
    if (els.picker.open) renderPicker()
    requestRender()
  })
}

els.status.addEventListener('click', () => {
  els.rateSheet.showModal()
  renderRateSheet()
})
els.rateCheck.addEventListener('click', refreshRates)

// A phone app sits in the background for days; check again when it comes back or reconnects.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastFetch > REFRESH_AFTER) refreshRates()
})
window.addEventListener('online', refreshRates)

// ---------- settings

function applyLayout() {
  els.ruler.classList.toggle('middle', state.layout === 'middle')
  els.optMiddle.checked = state.layout === 'middle'
}

els.openSettings.addEventListener('click', () => els.settings.showModal())
// A tap on the dimmed backdrop closes a sheet.
for (const sheet of [els.settings, els.rateSheet, els.picker]) {
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close()
  })
}
// The theme sets data-theme on the page; every colour, including the canvas's, comes from its tokens.
function applyTheme() {
  const root = document.documentElement
  root.dataset.theme = resolveTheme(state.theme, darkScheme.matches)
  els.themeColor.content = getComputedStyle(root).getPropertyValue('--paper').trim()
  colors = readColors()
  for (const input of els.themeOptions.querySelectorAll('input')) input.checked = input.value === state.theme
  requestRender()
}

els.themeOptions.innerHTML = THEMES.map(
  (t) => `<label class="theme-opt"><input type="radio" name="theme" value="${t.id}">` +
    `<span class="swatch" aria-hidden="true">${t.previews.map((p) => `<span class="swatch-part" data-theme="${p}"></span>`).join('')}</span>` +
    `<span>${t.name}</span></label>`,
).join('')
els.themeOptions.addEventListener('change', (e) => {
  state.theme = e.target.value
  applyTheme()
  savePrefs()
  if (!reduceMotion.matches) els.canvas.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })
})

els.optMiddle.addEventListener('change', () => {
  state.layout = els.optMiddle.checked ? 'middle' : 'edges'
  applyLayout()
  savePrefs()
  requestRender()
  if (!reduceMotion.matches) els.canvas.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' })
})

// ---------- start

applyLayout()
applyTheme()
syncCurrencyUi()
darkScheme.addEventListener('change', () => {
  if (state.theme === 'system') applyTheme()
})
document.fonts?.ready.then(requestRender)
refreshRates()

// ---------- installed app (PWA)

const updateToast = $('update-toast')
setupInstall()
$('update-reload').addEventListener('click', () => location.reload())
// __APP_VERSION__ and __APP_COMMIT__ are filled in by vite.config.js at build time.
$('about').textContent = `Version ${__APP_VERSION__} · ${__APP_COMMIT__}`

// Offline support and updates. Only production builds have a service worker (pnpm build, then
// pnpm preview to try it locally); the dev server always serves the files as they are.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Caches the hand-written worker used before the Vite build; the generated one keeps its own.
  caches.keys().then((keys) => keys.filter((key) => /^app-|^fonts-v1$/.test(key)).forEach((key) => caches.delete(key)))
  addEventListener('load', async () => {
    const hadWorker = Boolean(navigator.serviceWorker.controller)
    // A newer version took over while the app was open: offer to switch rather than reload under the user.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadWorker) updateToast.hidden = false
    })
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null)
    if (!reg) return
    // An installed app is rarely reloaded, so look for a new version whenever it comes back to the front.
    let lastCheck = Date.now()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > REFRESH_AFTER) {
        lastCheck = Date.now()
        reg.update().catch(() => {})
      }
    })
  })
}
