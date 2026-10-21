// Where the traveller is from, and where they are now, for the first ruler on a new device:
// the local currency on the left, where price tags are read, and their own on the right.
//
// Home is the region in the device's language setting ("ko-KR" → won). Where they are is the
// device's time zone, which phones set from where they are: a traveller landing in Tokyo has
// Asia/Tokyo. That needs no permission prompt, works offline and isn't fooled by roaming, which
// often routes through the home country. When the time zone doesn't name a country, the country
// Cloudflare sees for the connection stands in (worker/index.js, /api/where).

import { REGIONS } from './regions.js'

// The currency of a region; a currency issued by the region itself wins over a borrowed one.
export function currencyOf(region) {
  if (!region) return null
  let borrowed = null
  for (const [code, regions] of Object.entries(REGIONS)) {
    if (!regions.includes(region)) continue
    if (code.startsWith(region)) return code
    borrowed ??= code
  }
  return borrowed
}

// The region in the language settings: the first language that names one ("en-US"), or the one
// a bare language implies ("ja" → JP).
export function homeRegion() {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    try {
      const { region } = new Intl.Locale(tag)
      if (region) return region
    } catch {}
  }
  try {
    return new Intl.Locale(tags[0]).maximize().region ?? null
  } catch {
    return null
  }
}

// The region of the device's time zone. The browser lists each region's zones in the same
// naming it reports its own zone in, so the two always match (Asia/Saigon, not Asia/Ho_Chi_Minh).
export function timeZoneRegion() {
  let zone
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return null
  }
  if (!zone || zone.startsWith('Etc/') || zone === 'UTC') return null
  for (const region of new Set(Object.values(REGIONS).flat())) {
    try {
      const locale = new Intl.Locale(`und-${region}`)
      const zones = typeof locale.getTimeZones === 'function' ? locale.getTimeZones() : locale.timeZones
      if (zones?.includes(zone)) return region
    } catch {}
  }
  return null // this browser can't say (Firefox), or an unusual zone
}

// The country of the connection, as Cloudflare sees it.
export async function networkRegion() {
  try {
    const res = await fetch('/api/where', { cache: 'no-store' })
    return res.ok ? ((await res.json()).country ?? null) : null
  } catch {
    return null
  }
}

// The ruler for someone from home, now in `here`. At home, their own currency against the dollar.
export function rulerFor(here) {
  const home = currencyOf(homeRegion()) ?? 'USD'
  let local = currencyOf(here)
  if (!local || local === home) local = home === 'USD' ? 'EUR' : 'USD'
  return { a: local, b: home }
}
