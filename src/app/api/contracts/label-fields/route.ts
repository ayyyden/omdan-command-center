import { requirePermission } from "@/lib/auth-helpers"
import { AI_MODEL, createAiClient } from "@/lib/bank-review"

export const maxDuration = 120

// POST /api/contracts/label-fields
// The field editor's "Find blank lines" can see WHERE the blanks are on a
// scanned contract but can't read the printed words around them. This sends
// Claude a picture of the page with each found box numbered, and gets back
// for every box: a proper name ("Owner's Name", "Contractor Price"), the
// right type (signature / initials / date / multiline / text / checkbox),
// who fills it (Omdan staff or the customer), and whether it's a real blank
// at all (underlines and borders get dropped).

interface Box { n: number; x: number; y: number; width: number; height: number; kind: string }

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fields"],
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "keep", "label", "field_type", "fill_role"],
        properties: {
          n: { type: "integer" },
          keep: { type: "boolean", description: "false if this is not a blank someone writes in (a decorative underline, a table border, a line with printed text already on it)" },
          label: { type: "string", description: "Short name from the printed caption next to / under / above the blank, e.g. \"Owner's Name\", \"Contractor Price\", \"Owner's Signature\", \"Date\"" },
          field_type: { type: "string", enum: ["text", "multiline", "date", "signature", "initials", "checkbox"] },
          fill_role: { type: "string", enum: ["customer", "staff"] },
        },
      },
    },
  },
} as const

const SYSTEM = `You label the fill-in blanks on a contract form for Omdan Development, a Southern California home-improvement contractor (turf, pavers, concrete, landscaping). The image shows one page; each blank found by software is outlined and numbered.

For every number, read the printed words around that blank (left of it, under it as a caption like "(Owner's Name)", or above it) and return:
- label: a short, clear name taken from the printed caption. If two blanks share a caption (e.g. a table row), add the row, like "Payment 2 Amount". Title Case, no trailing colon.
- field_type:
  - signature: anything to sign (Signature, "X ____", Owner/Buyer/Customer/Contractor/Sales Person signature)
  - initials: Initial / Initials / "Intl." boxes or lines
  - date: Date, Dated, Start Date, Completion Date, Date of Birth / D.O.B.
  - multiline: a numbered "multiline" box (several stacked lines, e.g. description of work)
  - checkbox: a small square meant to be ticked
  - text: everything else
- fill_role: who fills it.
  - staff (Omdan fills it before sending): contractor / company / sales person / representative fields and signatures, license and state registration numbers, contract price, down payment, payment schedule amounts and descriptions, description of work and materials, start/completion dates, change order number, "not included" items, the contract date at the top.
  - customer: owner / buyer / customer / homeowner fields — their name, address, city/state/zip, phones, email, date of birth, their signatures, initials and dates next to their signatures.
- keep: false when the line is not a blank to write in (an underline under a heading, a page or table border, a line already carrying printed text). When unsure, keep it.

Return one entry per number shown.`

export async function POST(req: Request) {
  const session = await requirePermission("contracts:send")
  if (session instanceof Response) return session

  const body = await req.json().catch(() => null) as { image?: string; boxes?: Box[]; documentName?: string } | null
  const image = body?.image ?? ""
  const boxes = Array.isArray(body?.boxes) ? body!.boxes.slice(0, 120) : []
  const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
  if (!m || !boxes.length) return Response.json({ error: "image and boxes are required" }, { status: 400 })

  try {
    const response = await createAiClient().messages.stream({
      model: AI_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg" | "image/png" | "image/webp", data: m[2] } },
          {
            type: "text",
            text: `Document: ${body?.documentName ?? "contract"}\nNumbered blanks (page fractions, kind = what the line finder thinks):\n` +
              boxes.map((b) => `${b.n}: ${b.kind} at x ${b.x.toFixed(3)}, y ${b.y.toFixed(3)}, w ${b.width.toFixed(3)}, h ${b.height.toFixed(3)}`).join("\n"),
          },
        ],
      }],
    }).finalMessage()

    if (response.stop_reason === "refusal") return Response.json({ error: "Couldn't read this page" }, { status: 422 })
    const text = response.content.find((b) => b.type === "text")
    if (!text || text.type !== "text") return Response.json({ error: "No answer" }, { status: 502 })
    const parsed = JSON.parse(text.text) as { fields: { n: number; keep: boolean; label: string; field_type: string; fill_role: string }[] }
    return Response.json({ fields: parsed.fields })
  } catch (err) {
    console.error("[contracts/label-fields] failed:", err)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
