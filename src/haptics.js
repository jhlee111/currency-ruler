// A light tap from the phone: the ruler's detents, and a ruler landing in hand. Android has the
// vibration API. iOS doesn't, in any browser, but toggling a switch control
// (<input type="checkbox" switch>, Safari 17.4 / iOS 18) plays the system's own tick, so a hidden
// one is clicked instead. That's unofficial: Apple may change it, it's one fixed tick whatever
// `ms` asks for, and it's silent when System Haptics are off. Callers only tap for touch input,
// so desktops never get here.

let toggle = null // the hidden switch, made on first use

export function haptic(ms) {
  if (navigator.vibrate) {
    navigator.vibrate(ms)
    return
  }
  try {
    if (!toggle) {
      toggle = document.createElement('label')
      toggle.setAttribute('aria-hidden', 'true')
      toggle.style.display = 'none'
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('switch', '')
      input.tabIndex = -1
      toggle.append(input)
      document.body.append(toggle)
    }
    toggle.click()
  } catch {}
}
