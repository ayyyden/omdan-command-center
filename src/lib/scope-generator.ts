// Professional scope of work + estimate title generator.
// Uses Claude Haiku when ANTHROPIC_API_KEY is set; falls back to a deterministic
// template when the key is absent or the API call fails.

import Anthropic from "@anthropic-ai/sdk"

export interface ScopeResult {
  title: string
  scope: string
}

// ─── Template fallback ────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase())
}

function buildTemplateResult(services: string): ScopeResult {
  const parts = services.split(/[,\/&]/).map(s => s.trim()).filter(Boolean)
  const titledParts = parts.map(titleCase)
  const title = titledParts.join(" and ")

  const scope = [
    `Project Preparation:\nSite assessment, clearing, and preparation of the work area. Removal and disposal of existing materials as required prior to installation.`,
    `Work to be Completed:\n${titledParts.map(p => `${p}: Full installation and/or work completed to professional standards as agreed.`).join("\n")}`,
    `Cleanup and Disposal:\nAll construction debris, packaging, and excess materials removed from the property upon completion of work.`,
    `Exclusions:\nThis scope does not include permits, utility relocation, irrigation modifications, or any work not explicitly listed above. Any work beyond this scope requires a written change order and may incur additional charges.`,
    `Terms:\nAll work performed in a professional and workmanlike manner. Materials subject to availability and may be substituted with equivalents. Payment is due per the payment schedule outlined in this estimate.`,
  ].join("\n\n")

  return { title, scope }
}

// ─── Claude-generated scope ───────────────────────────────────────────────────

export async function generateEstimateScope(
  services: string,
  scopeOverride?: string,
): Promise<ScopeResult> {
  // If the user provided their own scope text, still generate a clean title from it.
  if (scopeOverride?.trim()) {
    const title = await generateTitleOnly(services, scopeOverride)
    return { title, scope: scopeOverride.trim() }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return buildTemplateResult(services)
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const result = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: `You are writing documents for a professional landscaping and home improvement contractor.

Services for this estimate: ${services}

Write a professional Scope of Work and a clean estimate title.

Requirements for the scope:
- 5 clearly labeled sections: "Project Preparation:", "Work to be Completed:", "Cleanup and Disposal:", "Exclusions:", "Terms:"
- Professional, business-ready language — no filler or generic corporate speak
- Specific to the services listed
- Assume assumptions where details are missing; state them clearly
- Suitable for a formal estimate document sent to a homeowner

Requirements for the title:
- Clean, professional (e.g. "Pavers and Artificial Turf Installation")
- Not the raw service list — proper noun form
- 3–6 words maximum

Respond in JSON only, no markdown:
{"title": "...", "scope": "..."}`,
        },
      ],
    })

    const text = result.content[0].type === "text" ? result.content[0].text.trim() : ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return buildTemplateResult(services)

    const parsed = JSON.parse(jsonMatch[0]) as { title?: string; scope?: string }
    if (!parsed.title || !parsed.scope) return buildTemplateResult(services)

    return { title: parsed.title, scope: parsed.scope }
  } catch (err) {
    console.error("[scope-generator] Claude API error:", err)
    return buildTemplateResult(services)
  }
}

// ─── Title-only generation (when scope is manually provided) ──────────────────

async function generateTitleOnly(services: string, scope: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return buildTemplateResult(services).title
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const result = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 80,
      messages: [
        {
          role: "user",
          content: `Generate a clean, professional estimate title (3–6 words) for a landscaping/home improvement project.
Services: ${services}
Scope summary: ${scope.slice(0, 300)}

Respond with only the title text, nothing else.`,
        },
      ],
    })
    const title = result.content[0].type === "text" ? result.content[0].text.trim() : ""
    return title || buildTemplateResult(services).title
  } catch {
    return buildTemplateResult(services).title
  }
}
