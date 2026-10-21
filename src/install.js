// Getting the app onto the home screen. Installed, it opens full screen and works with no
// signal, which is the point abroad. This offers it once, gently, and shows how on whatever
// browser this is. In-app browsers (KakaoTalk, LINE, Instagram…) can't install at all, so
// there the first step is getting the page into a real browser.

const KEY = 'currency-ruler:install' // { visits, dismissed, installed }
const ua = navigator.userAgent
const isIos = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isAndroid = /Android/i.test(ua)
const isMacSafari = !isIos && /Macintosh/.test(ua) && /Version\/[\d.]+ Safari\//.test(ua)
const isFirefoxDesktop = !isIos && !isAndroid && /Firefox\//.test(ua)
const iosBrowser = /CriOS/.test(ua) ? 'Chrome' : /FxiOS/.test(ua) ? 'Firefox' : /EdgiOS/.test(ua) ? 'Edge' : 'Safari'

// The app whose built-in browser this is, if any.
const inApp = /KAKAOTALK/i.test(ua)
  ? 'KakaoTalk'
  : /NAVER\(inapp/i.test(ua)
    ? 'Naver'
    : /\bLine\//.test(ua)
      ? 'LINE'
      : /Instagram/i.test(ua)
        ? 'Instagram'
        : /FBAN|FBAV/.test(ua)
          ? 'Facebook'
          : /DaumApps/i.test(ua)
            ? 'Daum'
            : isAndroid && /; wv\)/.test(ua)
              ? 'This app'
              : null

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true

const $ = (id) => document.getElementById(id)
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}
const save = (s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {}
}

const ICON = {
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L8 7m4-4 4 4M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
  done: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17l9-10"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>',
  browser: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
}

const steps = (items) =>
  `<ol class="install-steps">${items
    .map(([icon, title, note]) => `<li><span class="install-icon">${ICON[icon]}</span><span><strong>${title}</strong>${note ? `<small>${note}</small>` : ''}</span></li>`)
    .join('')}</ol>`

export function setupInstall() {
  const hint = $('install-hint')
  const sheet = $('install-sheet')
  const body = $('install-body')
  const item = $('install-item')
  const itemButton = $('install-btn')
  const settings = $('settings')
  let prompt = null // Chrome and Edge hand over their install dialog to call when we choose

  const state = load()
  // Count visits once per browsing session, not once per reload.
  try {
    if (!sessionStorage.getItem(KEY)) {
      sessionStorage.setItem(KEY, '1')
      state.visits = (state.visits || 0) + 1
      save(state)
    }
  } catch {}

  // Whether this browser can install the app at all, one way or another.
  const installable = () => Boolean(prompt || inApp || isIos || isMacSafari)

  // The steps for this browser.
  function guide() {
    if (prompt) {
      return `<p class="install-lead">Add Currency Ruler to your home screen. It opens full screen and keeps working without a connection.</p>
        <button type="button" class="tool wide primary" data-act="prompt">Install</button>`
    }
    if (inApp) {
      const browser = isIos ? 'Safari' : 'Chrome'
      const direct = inApp === 'KakaoTalk' || inApp === 'LINE' || isAndroid
      return `<p class="install-lead">${inApp}’s built-in browser can’t install apps, and it may not keep your settings. Open this page in ${browser} first, then install it from there.</p>
        ${direct ? `<button type="button" class="tool wide primary" data-act="external">Open in ${isIos ? 'Safari' : 'your browser'}</button>` : steps([['more', 'Tap ··· or the share button', 'At the top or bottom of the screen.'], ['browser', `Choose “Open in ${browser}”`, 'It may say “Open in browser”.']])}
        <button type="button" class="tool wide" data-act="copy">Copy link</button>`
    }
    if (isIos) {
      const where = iosBrowser === 'Safari' ? 'In the toolbar. In newer Safari, tap ··· first.' : `In ${iosBrowser}, it’s next to the address bar.`
      return `<p class="install-lead">Add Currency Ruler to your home screen. It opens full screen and keeps working without a connection.</p>
        ${steps([['share', 'Tap Share', where], ['add', 'Tap “Add to Home Screen”', 'Scroll down the list if you don’t see it.'], ['done', 'Tap Add', 'The ruler appears on your home screen.']])}`
    }
    if (isMacSafari) return `<p class="install-lead">In Safari, choose File → Add to Dock. Currency Ruler then opens in its own window and works offline.</p>`
    if (isAndroid) return `<p class="install-lead">Open the browser menu (⋮) and tap “Install app” or “Add to Home screen”.</p>`
    if (isFirefoxDesktop) return `<p class="install-lead">Firefox can’t install apps on a computer. Open this page in Chrome, Edge or Safari to install it.</p>`
    return `<p class="install-lead">Use your browser’s menu to install Currency Ruler or add it to your home screen.</p>`
  }

  function openGuide() {
    if (settings.open) settings.close()
    hideHint(true)
    body.innerHTML = guide()
    sheet.showModal()
  }

  function render() {
    item.hidden = standalone()
    itemButton.textContent = prompt ? 'Install' : inApp ? 'Open in browser' : 'Show me how'
  }

  // The hint appears once: from the second visit (straight away in an in-app browser, where
  // nothing would stick), and never again after it's opened, dismissed or the app is installed.
  function offerHint() {
    if (standalone() || state.dismissed || state.installed || !installable()) return
    if (!inApp && (state.visits || 0) < 2) return
    $('install-hint-label').textContent = inApp ? 'Open in browser to install' : 'Install for offline use'
    setTimeout(() => (hint.hidden = false), 1500)
  }

  function hideHint(forGood) {
    hint.hidden = true
    if (forGood && !state.dismissed) {
      state.dismissed = true
      save(state)
    }
  }

  async function runPrompt() {
    if (!prompt) return
    const p = prompt
    prompt = null
    p.prompt()
    await p.userChoice.catch(() => {})
    if (sheet.open) sheet.close()
    render()
  }

  function openExternally() {
    const url = location.href
    if (inApp === 'KakaoTalk') location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`
    else if (inApp === 'LINE') location.href = `${url}${url.includes('?') ? '&' : '?'}openExternalBrowser=1`
    else if (isAndroid) location.href = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`
  }

  body.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'prompt') runPrompt()
    else if (act === 'external') openExternally()
    else if (act === 'copy') {
      const button = e.target.closest('button')
      try {
        await navigator.clipboard.writeText(location.href)
        button.textContent = 'Link copied'
      } catch {
        button.textContent = location.href
      }
    }
  })
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close()
  })
  $('install-hint-open').addEventListener('click', openGuide)
  $('install-hint-close').addEventListener('click', () => hideHint(true))
  itemButton.addEventListener('click', () => (prompt ? runPrompt() : openGuide()))

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // ours to offer, at a calmer moment than page load
    prompt = e
    render()
    offerHint()
  })
  addEventListener('appinstalled', () => {
    prompt = null
    state.installed = true
    save(state)
    hideHint(false)
    render()
  })

  render()
  offerHint()
}
