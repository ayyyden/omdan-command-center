import { NextRequest } from "next/server"
import { verifyRetellSecret, readToolCall, toolReply, customerNumber } from "@/lib/retell"
import { sendQuoSms } from "@/lib/quo-client"
import { BRANDS } from "@/lib/appointments"

const SITE = "https://omdandevelopment.com"

// Pages the agent may send. Only real, public pages of the website.
const LINKS: Record<string, { en: string; es: string; url: string }> = {
  website:   { en: "our website",                 es: "nuestro sitio web",                url: `${SITE}/` },
  estimate:  { en: "book your free estimate here", es: "reserve su estimado gratis aquí", url: `${SITE}/#contact` },
  projects:  { en: "photos of our work",          es: "fotos de nuestros trabajos",       url: `${SITE}/projects/` },
  reviews:   { en: "our Google reviews",          es: "nuestras reseñas de Google",       url: `${SITE}/#testimonials` },
  license:   { en: "our CSLB license (#1148568)", es: "nuestra licencia CSLB (#1148568)", url: "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=1148568" },
  turf:      { en: "artificial turf",   es: "pasto artificial",          url: `${SITE}/artificial-turf/` },
  pavers:    { en: "pavers",            es: "adoquines (pavers)",        url: `${SITE}/pavers/` },
  concrete:  { en: "concrete",          es: "concreto",                  url: `${SITE}/concrete/` },
  gravel:    { en: "gravel & xeriscape", es: "grava y xeriscape",        url: `${SITE}/gravel/` },
  pool:      { en: "pool remodeling",   es: "remodelación de albercas",  url: `${SITE}/pool-remodeling/` },
  kitchen:   { en: "kitchen remodeling", es: "remodelación de cocinas",  url: `${SITE}/kitchen-remodeling/` },
  bathroom:  { en: "bathroom remodeling", es: "remodelación de baños",   url: `${SITE}/bathroom-remodeling/` },
  windows:   { en: "windows",           es: "ventanas",                  url: `${SITE}/windows/` },
  roofing:   { en: "roofing",           es: "techos",                    url: `${SITE}/roofing/` },
  insulation:{ en: "insulation",        es: "aislamiento",               url: `${SITE}/insulation/` },
  hvac:      { en: "HVAC",              es: "aire acondicionado (HVAC)", url: `${SITE}/hvac/` },
  gutters:   { en: "gutters",           es: "canaletas",                 url: `${SITE}/gutters/` },
  plumbing:  { en: "plumbing",          es: "plomería",                  url: `${SITE}/plumbing/` },
  painting:  { en: "exterior painting", es: "pintura exterior",          url: `${SITE}/exterior-painting/` },
  "cool-life-paint": { en: "Cool Life Paint", es: "Cool Life Paint",     url: `${SITE}/cool-life-paint/` },
}

// POST /api/retell/send-text — Retell tool "send_text".
// Texts the caller from the business Quo number: one or more links, and/or a
// short custom note (e.g. "send photos of your yard to this number").
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const { args, call } = await readToolCall<{
    phone?:    string
    links?:    string[]
    note?:     string
    language?: "en" | "es"
  }>(req)
  const lang = args.language === "es" ? "es" : "en"
  const to = args.phone || customerNumber(call)
  if (!to) return toolReply({ ok: false, message: "Ask for the best cell number to text." })

  const links = (args.links ?? []).filter((k) => LINKS[k]).slice(0, 4)
  const note = (args.note ?? "").trim().slice(0, 300)
  if (!links.length && !note) return toolReply({ ok: false, message: "Nothing to send. Pass links and/or a note." })

  const lines = [
    lang === "es" ? "Omdan Development: ¡Gracias por llamar!" : "Omdan Development: Thanks for calling!",
    note || null,
    ...links.map((k) => `${LINKS[k][lang]}: ${LINKS[k].url}`),
    lang === "es" ? "Llame o escriba: (951) 292-0703" : "Call or text: (951) 292-0703",
  ].filter(Boolean)

  const sms = await sendQuoSms(to, lines.join("\n"), BRANDS.omdan.quoFrom)
  return toolReply(sms.ok
    ? { ok: true, message: "Text sent. Let them know it should arrive in a moment." }
    : { ok: false, message: "The text didn't go through. Read the website out loud: omdandevelopment.com." })
}
