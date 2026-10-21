// The app itself is static files (./dist). This Worker only takes the anonymous usage events the
// app sends to /api/event and writes them to Workers Analytics Engine; everything else goes
// straight to the files. Nothing personal is kept: no IP, no identifier. The country comes from
// Cloudflare's own request data.
//
// Each event is one data point, in fixed columns (scripts/stats.mjs reads them back):
//   blob1 event      open · swipe · add · edit · remove · flip · type · share · install · theme · layout · rates
//   blob2 ruler      the pair in hand, "JPY/USD"
//   blob3 platform   ios · android · mac · windows · other
//   blob4 display    installed · browser · in-app:<app>
//   blob5 country    ISO code from Cloudflare
//   blob6 theme      blob7 layout      blob8 app version
//   blob9 detail     what the event is about: the pair added, "copy" for a copied link…
//   blob10 language  the device's, "ko-KR"
//   double1 rulers   how many rulers the device keeps
//   double2 first    1 for the first open of the day on that device (daily users), else 0

const EVENTS = new Set(['open', 'swipe', 'add', 'edit', 'remove', 'flip', 'type', 'share', 'install', 'theme', 'layout', 'rates'])

const text = (v, max = 24) => (typeof v === 'string' ? v.slice(0, max) : '')

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === '/api/event') return event(request, env)
    return env.ASSETS.fetch(request)
  },
}

async function event(request, env) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  let e
  try {
    e = JSON.parse(await request.text())
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!EVENTS.has(e?.name)) return new Response(null, { status: 400 })
  env.EVENTS?.writeDataPoint({
    indexes: [e.name],
    blobs: [
      e.name,
      text(e.pair),
      text(e.platform),
      text(e.display),
      text(request.cf?.country),
      text(e.theme),
      text(e.layout),
      text(e.version),
      text(e.detail, 48),
      text(e.lang),
    ],
    doubles: [Number(e.rulers) || 0, e.first ? 1 : 0],
  })
  return new Response(null, { status: 204 })
}
