// The themes Settings offers. Each id matches a [data-theme] block in styles.css, which holds
// all of its colours, so adding a theme is one block there and one line here.
// 'system' isn't a theme of its own: it follows the device between light and dark.
export const THEMES = [
  { id: 'system', name: 'System', previews: ['light', 'dark'] },
  { id: 'light', name: 'Light', previews: ['light'] },
  { id: 'dark', name: 'Dark', previews: ['dark'] },
  { id: 'wood', name: 'Wood', previews: ['wood'] },
]

export const isTheme = (id) => THEMES.some((t) => t.id === id)

export const resolveTheme = (id, prefersDark) => (id === 'system' ? (prefersDark ? 'dark' : 'light') : id)
