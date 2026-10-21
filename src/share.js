// Passing the app on. Travellers share it face to face (a QR code to scan across the table) or
// in a chat (the phone's own share sheet, or the link copied). The link is always the app's
// public address, whichever address this copy happens to be running from.

const APP_URL = 'https://fx-ruler.subtl.ink/'
const SHARE = { title: 'Currency Ruler', text: 'Read prices in two currencies at a glance, even offline.', url: APP_URL }

const $ = (id) => document.getElementById(id)

export function setupShare() {
  const sheet = $('share-sheet')
  const qr = $('share-qr')
  const send = $('share-send')
  const copy = $('share-copy')
  const settings = $('settings')

  // Not every browser has a share sheet (most desktop ones don't); copying the link always works.
  send.hidden = !navigator.share

  async function open() {
    if (settings.open) settings.close()
    copy.textContent = 'Copy link'
    if (!qr.firstChild) {
      // Loaded on first use; the service worker keeps it for offline. Dark on white whatever the
      // theme, since that's what cameras read best.
      const { renderSVG } = await import('uqr')
      qr.innerHTML = renderSVG(APP_URL, { border: 2, blackColor: '#2a1209', whiteColor: '#ffffff' })
    }
    sheet.showModal()
  }

  send.addEventListener('click', async () => {
    try {
      await navigator.share(SHARE)
      sheet.close()
    } catch {} // dismissed: stay on the sheet
  })
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(APP_URL)
      copy.textContent = 'Link copied'
    } catch {
      copy.textContent = APP_URL
    }
  })
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close()
  })
  $('share-btn').addEventListener('click', open)
}
