import { REGIONS } from './regions.js'

// Every name the app shows comes through LOCALE, so translating later means changing this
// one value (and adding translated short names). Search keeps matching English either way.
export const LOCALE = 'en'

// Shorter names for the ruler's column headings, where space is tight.
const SHORT = {
  USD: 'Dollars',
  JPY: 'Yen',
  KRW: 'Won',
  EUR: 'Euros',
  GBP: 'Pounds',
  CNY: 'Yuan',
  HKD: 'HK dollars',
  SGD: 'Singapore dollars',
  THB: 'Baht',
  AUD: 'Australian dollars',
  CAD: 'Canadian dollars',
}

// Symbols that read better than what Intl gives in English (often just the code).
const SYMBOL = {
  USD: '$',
  JPY: '¥',
  KRW: '₩',
  EUR: '€',
  GBP: '£',
  CNY: 'CN¥',
  HKD: 'HK$',
  SGD: 'S$',
  THB: '฿',
  AUD: 'A$',
  CAD: 'C$',
}
// Local symbols shared by several currencies; those show their code instead (CLP 100, not $100).
const AMBIGUOUS = new Set(['$', '£', '¥', 'kr', 'Rs'])

const names = new Intl.DisplayNames([LOCALE], { type: 'currency', fallback: 'code' })
const regionNames = new Intl.DisplayNames([LOCALE], { type: 'region', fallback: 'code' })

// "Vietnamese Dong" → "Vietnamese dong", "US Dollar" → "US dollar"; one-word names stay as they are.
function sentenceCase(name) {
  return name.replace(/ ([A-Z][a-zà-ÿʻ’']+)$/u, (_, word) => ` ${word.toLowerCase()}`)
}

function symbolFor(code) {
  if (SYMBOL[code]) return SYMBOL[code]
  const part = (display) =>
    new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code, currencyDisplay: display })
      .formatToParts(1)
      .find((p) => p.type === 'currency').value
  let symbol = part('symbol')
  if (symbol === code) {
    const narrow = part('narrowSymbol')
    symbol = narrow !== code && !AMBIGUOUS.has(narrow) ? narrow : code
  }
  // Right-to-left symbols (؋) would otherwise flip the number next to them.
  if (/[\u0590-\u08FF]/u.test(symbol)) symbol = `${symbol}\u200E`
  // Letter symbols get a space before the number: "Rp 100", "AED 100".
  return /\p{L}$/u.test(symbol) && symbol.length > 1 ? `${symbol} ` : symbol
}

// Units several currencies share; a heading needs the code to tell them apart.
const SHARED_UNIT = /^(dollar|peso|pound|franc|rupee|dinar|krone|krona|króna|shilling|rial|riyal|lira|mark)$/

// "Vietnamese dong" is too long for a column heading; "Dong" isn't. "New Taiwan dollar" → "TWD dollars".
function shortName(code, name) {
  if (SHORT[code]) return SHORT[code]
  if (name.length <= 14) return name
  const unit = name.split(' ').pop()
  // Krona, krone and króna have irregular plurals, so they stay singular.
  if (SHARED_UNIT.test(unit)) return `${code} ${unit}${/^kr[oó]n/.test(unit) ? '' : 's'}`
  return unit[0].toUpperCase() + unit.slice(1)
}

function describe(code) {
  const name = sentenceCase(names.of(code))
  const regions = REGIONS[code]
  return {
    code,
    name,
    short: shortName(code, name),
    symbol: symbolFor(code),
    // Decimal places the currency normally uses (JPY 0, USD 2, KWD 3).
    minor: new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits,
    regions,
    regionNames: regions.map((r) => regionNames.of(r)),
  }
}

export const CODES = Object.keys(REGIONS)
export const CURRENCIES = Object.fromEntries(CODES.map((code) => [code, describe(code)]))

// ECB reference rates (units per 1 USD) bundled with the app, used until a live rate loads.
// Only ECB data ships with the app; other sources may be cached on the device but not redistributed.
export const SNAPSHOT = {
  date: '2026-10-20',
  rates: {
    AUD: 1.4317,
    BRL: 5.0235,
    CAD: 1.4051,
    CHF: 0.82363,
    CNY: 6.678,
    CZK: 21.693,
    DKK: 6.6648,
    EUR: 0.89166,
    GBP: 0.74925,
    HKD: 7.8487,
    HUF: 325.17,
    IDR: 17986,
    ILS: 3.1077,
    INR: 94.93,
    ISK: 121.44,
    JPY: 158.13,
    KRW: 1327.84,
    MXN: 18.5216,
    MYR: 4.0827,
    NOK: 9.3843,
    NZD: 1.7609,
    PHP: 63.133,
    PLN: 3.9026,
    RON: 4.7533,
    SEK: 9.918,
    SGD: 1.2785,
    THB: 33.65,
    TRY: 49.577,
    USD: 1,
    ZAR: 16.4752,
  },
}
