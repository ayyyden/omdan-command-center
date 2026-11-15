// What customers are told about the time: an arrival window, not an exact
// time, so David has room to drive between appointments.
//   - 6 PM or later: a 1-hour window  (6 PM -> "between 6 and 7 PM")
//   - anything earlier: a 2-hour window (9 AM -> "between 9 and 11 AM")
// Pure (no server imports) so client components can use it too.

export function windowHours(time: string): number {
  const [h] = time.split(":").map(Number)
  return h >= 18 ? 1 : 2
}

function parts(time: string) {
  const [h, m] = time.split(":").map(Number)
  const endTotal = (h * 60 + m + windowHours(time) * 60) % (24 * 60)
  return { h, m, eh: Math.floor(endTotal / 60), em: endTotal % 60 }
}

const h12 = (h: number) => ((h + 11) % 12) + 1
const mm = (m: number) => (m ? `:${String(m).padStart(2, "0")}` : "")

/** "between 9 and 11 AM", "between 11 AM and 1 PM", "entre las 9 y las 11 de la mañana". */
export function arrivalWindow(time: string, lang: "en" | "es" = "en"): string {
  const { h, m, eh, em } = parts(time)
  if (lang === "es") {
    const part = (x: number) => (x < 12 ? "de la mañana" : x < 19 ? "de la tarde" : "de la noche")
    const la = (x: number) => (h12(x) === 1 ? "la" : "las")
    const a = `${la(h)} ${h12(h)}${mm(m)}`
    const b = `${la(eh)} ${h12(eh)}${mm(em)}`
    return part(h) === part(eh) ? `entre ${a} y ${b} ${part(eh)}` : `entre ${a} ${part(h)} y ${b} ${part(eh)}`
  }
  const ap = (x: number) => (x < 12 ? "AM" : "PM")
  return ap(h) === ap(eh)
    ? `between ${h12(h)}${mm(m)} and ${h12(eh)}${mm(em)} ${ap(eh)}`
    : `between ${h12(h)}${mm(m)} ${ap(h)} and ${h12(eh)}${mm(em)} ${ap(eh)}`
}
