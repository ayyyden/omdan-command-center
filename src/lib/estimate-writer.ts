// "Write it for me": turns Edan's short after-the-visit note ("patio, 4-6
// lights, 1 fan, aluminum double roof, mist line, 18726, 4 payments: permit
// 7000, material 5000, installed 5000, completion 1726") into the detailed,
// numbered scope + payment schedule + project notes that goes on the estimate.
// Same model + client as the rest of the CRM's AI (bank-review.ts).

import { AI_MODEL, createAiClient } from "@/lib/bank-review"

export interface WrittenEstimate {
  title:         string
  total:         number | null
  sections:      { heading: string; bullets: string[] }[]
  payment_steps: { name: string; description: string; amount: number }[]
  notes:         string[]
  /** Set when the payments still don't add up to the total after a retry */
  warning?:      string
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "total", "sections", "payment_steps", "notes"],
  properties: {
    title: { type: "string", description: "3–7 word project title, Title Case, e.g. \"Aluminum Patio Cover Installation\"" },
    total: { anyOf: [{ type: "number" }, { type: "null" }], description: "Total contract price from the note, or null if none was given" },
    sections: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["heading", "bullets"],
        properties: { heading: { type: "string" }, bullets: { type: "array", items: { type: "string" } } },
      },
    },
    payment_steps: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["name", "description", "amount"],
        properties: { name: { type: "string" }, description: { type: "string" }, amount: { type: "number" } },
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
} as const

const SYSTEM = `You write the Scope of Work for estimates of Omdan Development Inc., a licensed Southern California home-improvement contractor (patio covers, pergolas, turf, pavers, concrete, block walls, fire features, landscaping, remodels).

The owner writes a short note after meeting the homeowner. You turn it into a detailed, professional, fully scoped estimate the homeowner reads and signs.

CORE RULE — EXPAND THE LANGUAGE, NOT THE COMMITMENT:
- Describe the normal professional installation steps for exactly the items in the note, clearly and in homeowner-friendly language.
- Keep every quantity, size, material and option EXACTLY as written ("4–6 LED ceiling lights", "one (1) outdoor-rated ceiling fan", "approximately 500 sq. ft.", "double-layer"). Write counts as words + digits for single units: "one (1)".
- NEVER invent: brands or model names, measurements or square footage not given, warranties or guarantees, completion dates or durations, "premium/luxury" claims, or extra services/items not in the note.
- Permits, architectural plans, engineering or inspections only when the note mentions them.
- Demolition / removal / haul-away of existing material only when mentioned; routine cleanup of job-related debris is always fine.
- Don't assume how something is built when the note doesn't say: attached vs. freestanding, footings, concrete, excavation, ledger boards, power source location. Say it neutrally instead ("Secure the patio structure to the designated foundation and/or existing structure as approved.", "Connect to an accessible existing power source.").

STRUCTURE:
- sections: 5–10 numbered phases in the order the work happens. Usually: any planning/permit phase first (if mentioned) → site preparation & layout → one section per main item of work (structure, roof, electrical/lighting, fan, misting, etc.) → "Final Finishing, Inspection & Cleanup" last (inspect, test what was installed, cleanup, final walkthrough with the homeowner).
- Each section: a short heading (no number) and 4–7 bullets. Each bullet is one complete sentence starting with a verb ("Supply and install…", "Install…", "Verify…", "Test…"), ending with a period.
- payment_steps: exactly the payments in the note, in order, with their exact amounts. name = a short professional milestone ("Architectural Planning & Permit Submission", "Material Delivery", "Patio Installation", "Project Completion & Cleanup"; "deposit" → "Deposit", "material arrive" → "Material Delivery", "done/rest/final/balance" → "Project Completion & Cleanup"). description = when it is due, starting with "Upon …". The amounts MUST add up exactly to the total. If the note gives a total but no payments, return no payment steps.
- notes: 3–5 short project notes, like: work performed per applicable codes (and approved plans when there are plans); final dimensions/configuration per approved drawings (only when there are drawings); permit timelines are subject to the building department (only when permits are mentioned); additional work outside this scope requires written authorization.
- title: 3–7 words, Title Case.

EXAMPLE
Note: "write me a scoop of work detailed of patio installation with 4-6 lights 1 ceilling fan aluminum material with insallation roof (double layer) and a mist line total 18726 with a 4 payment plan architectual planing and permit submited 7000, material arrive 5000, patio installed, 5000, completion and clean up, 1726"
Good output (abridged):
title: "Aluminum Patio Cover Installation", total: 18726
sections: "Architectural Planning & Permit Submission" (prepare architectural plans and layout; develop structural specifications and construction drawings as required; submit plans to the local building department for permit review; coordinate revisions requested by the building department; ensure the proposed construction complies with applicable local building codes), "Site Preparation & Layout", "Aluminum Patio Cover Installation", "Double-Layer Insulated Roof Installation", "Electrical & Recessed Lighting Installation" ("Supply and install 4–6 LED ceiling lights integrated into the patio cover." …), "Ceiling Fan Installation" ("Supply and install one (1) outdoor-rated ceiling fan." …), "Outdoor Misting System Installation", "Final Finishing, Inspection & Cleanup".
payment_steps: Architectural Planning & Permit Submission 7000 ("Upon completion of architectural planning and submission of permit documents"), Material Delivery 5000 ("Upon arrival of aluminum patio structure, roofing materials, and installation components"), Patio Installation 5000 ("Upon installation of the aluminum patio structure and double-layer roof"), Project Completion & Cleanup 1726 ("Upon completion of remaining installations, final testing, and jobsite cleanup").
notes: "All work will be performed in accordance with applicable building codes and approved plans.", "Final patio dimensions and configuration will be determined by approved architectural drawings.", "Permit approval timelines are subject to the local building department.", "Any additional work or modifications outside the approved scope will require written authorization."

The note may be messy, misspelled, or in Spanglish — understand it, write clean English.`

async function ask(brief: string, feedback?: string, revise?: { current: WrittenEstimate; change: string }): Promise<WrittenEstimate> {
  const response = await createAiClient().messages.stream({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: revise
        ? `Note:\n${brief}\n\nThis is the estimate written so far (JSON):\n${JSON.stringify(revise.current)}\n\nThe owner wants this change: ${revise.change}\nApply exactly that change and keep everything else the same. Return the whole estimate.${feedback ? `\n\nAlso fix: ${feedback}` : ""}`
        : `Note:\n${brief}${feedback ? `\n\nFix this in your answer: ${feedback}` : ""}`,
    }],
  }).finalMessage()
  if (response.stop_reason === "refusal") throw new Error("The AI couldn't write this one — try rewording the note")
  const text = response.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") throw new Error("No answer from the AI")
  return JSON.parse(text.text) as WrittenEstimate
}

const cents = (n: number) => Math.round(n * 100)

export async function writeEstimate(brief: string, revise?: { current: WrittenEstimate; change: string }): Promise<WrittenEstimate> {
  let out = await ask(brief, undefined, revise)
  const sum = () => out.payment_steps.reduce((t, p) => t + cents(p.amount), 0)
  if (out.total != null && out.payment_steps.length && sum() !== cents(out.total)) {
    out = await ask(brief, `the payment amounts add up to ${(sum() / 100).toFixed(2)} but the total is ${out.total}. Use exactly the amounts and total from the note.`, revise)
    if (out.total != null && out.payment_steps.length && sum() !== cents(out.total)) {
      out.warning = `The payments add up to $${(sum() / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} but the total is $${out.total.toLocaleString("en-US", { minimumFractionDigits: 2 })} — please check them.`
    }
  }
  out.sections = out.sections.map((s) => ({ heading: s.heading.replace(/^\s*\d+[.)]\s*/, "").trim(), bullets: s.bullets.map((b) => b.trim()).filter(Boolean) })).filter((s) => s.heading)
  return out
}
