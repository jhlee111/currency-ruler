// Anonymous usage counts, so we learn which currencies travellers carry and which parts of the
// app earn their place. No identifier and nothing personal: each event says what happened, on
// what kind of device, with which ruler. worker/index.js stores them. Only the real app sends them
// (production builds), and an event that can't go out (offline) is simply dropped.

import { device } from './install.js'

const DAY_KEY = 'currency-ruler:last-open' // the last day this device opened the app; never sent

let context = () => ({})

// `get` supplies what every event carries about the app's state: the ruler in hand and so on.
export function setupStats(get) {
  context = get
}

function send(fields) {
  if (!import.meta.env.PROD || !navigator.sendBeacon) return
  const body = JSON.stringify({
    version: __APP_VERSION__,
    platform: device.platform,
    display: device.display(),
    lang: navigator.language,
    ...context(),
    ...fields,
  })
  try {
    navigator.sendBeacon('/api/event', new Blob([body], { type: 'application/json' }))
  } catch {}
}

export const track = (name, detail) => send({ name, detail })

// Opening the app. The first open of a day is flagged, which counts daily users without
// telling one device from another.
export function trackOpen() {
  const today = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD, local
  let first = true
  try {
    first = localStorage.getItem(DAY_KEY) !== today
    localStorage.setItem(DAY_KEY, today)
  } catch {}
  send({ name: 'open', first })
}
