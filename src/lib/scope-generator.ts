// Professional scope of work + estimate title generator.
// Uses Claude Sonnet when ANTHROPIC_API_KEY is set; falls back to a deterministic
// template when the key is absent or the API call fails.
//
// Core principle: expand the language, not the commitment.
// Short inputs ("turf job", "bathroom remodel new tile vanity") are expanded
// into professional construction prose WITHOUT inventing brands, measurements,
// warranties, permits, or anything the owner did not specify.

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
    `Project Preparation:\nWork area to be assessed and prepared prior to commencement. Existing conditions reviewed and any required clearing coordinated with the customer.`,
    `Work to be Completed:\n${titledParts.map(p => `${p}: Work to be completed in a professional and workmanlike manner as described and agreed upon.`).join("\n")}`,
    `Cleanup and Disposal:\nAll job-related debris, materials, and packaging to be removed from the property upon project completion.`,
    `Exclusions:\nThis scope covers only the services described above. It does not include permits, utility work, or any items not explicitly listed. Any additional work requires a separate written change order.`,
    `Terms:\nAll work performed to professional standards. Materials subject to availability; equivalent substitutions may be used with customer notification. Payment is due per the schedule outlined in this estimate.`,
  ].join("\n\n")

  return { title, scope }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SCOPE_SYSTEM_PROMPT = `You are a professional construction and remodeling office assistant writing Scope of Work documents for a residential contractor.

Your job is to turn short, informal service descriptions into polished, professional scope language — without inventing details the contractor did not provide.

CORE PRINCIPLE: EXPAND THE LANGUAGE, NOT THE COMMITMENT.

NEVER invent or add any of the following — if it was not in the input, it does not belong in the scope:
- Specific product brands, model names, or manufacturer names
- Exact measurements, square footage, linear feet, thicknesses, depths, or quantities
- Warranty terms, warranty durations, or guarantee language
- Permits, inspections, or code compliance claims (unless explicitly mentioned)
- Engineering, structural analysis, drainage design, or licensed design services
- Demolition, removal, or haul-away of existing materials (unless explicitly mentioned)
- Irrigation, plumbing, or utility modifications (unless explicitly mentioned)
- Completion timelines, scheduling promises, or deadline commitments
- "Premium," "luxury," "high-end," or superior material claims
- Any service, item, or commitment not directly described in the input

WHAT TO DO:
- Translate trade shorthand into professional, homeowner-readable prose
- Use clear, step-by-step language appropriate to the specific trade
- Keep each point concise — 1 to 3 sentences is enough
- Sound polished and professional, not overly technical or salesy
- Use trade-specific vocabulary (turf work ≠ paver work ≠ concrete work — use the right terms)
- A generic cleanup and change-order note are always appropriate

Scope structure — use exactly these section labels, each on its own line:
"Project Preparation:" — work area prep specific to this trade
"Work to be Completed:" — the actual work, in logical steps, no invented specifics
"Cleanup and Disposal:" — standard post-job site cleanup
"Exclusions:" — what is not included; always close with: "Any work outside the agreed scope requires a separate written change order."
"Terms:" — brief, standard workmanship and payment terms (keep consistent across scopes)`

// ─── Claude-generated scope ───────────────────────────────────────────────────

export async function generateEstimateScope(
  services: string,
  scopeOverride?: string,
): Promise<ScopeResult> {
  // If the user provided their own scope text, keep it as-is and only generate a title.
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
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: SCOPE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Services input: "${services}"

Write the Scope of Work and a professional estimate title for this project.

Title requirements:
- Professional trade-appropriate name (e.g. "Artificial Turf Installation", "Bathroom Remodel", "Exterior Painting", "Concrete Patio Installation")
- 3–6 words, proper noun capitalization
- Not the raw input — a clean document title

Respond in JSON only, no markdown, no code fences:
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
          content: `Generate a clean, professional estimate title (3–6 words) for a construction/remodeling project.
Services: ${services}
Scope summary: ${scope.slice(0, 300)}

Respond with only the title text, no quotes, nothing else.`,
        },
      ],
    })
    const title = result.content[0].type === "text" ? result.content[0].text.trim() : ""
    return title || buildTemplateResult(services).title
  } catch {
    return buildTemplateResult(services).title
  }
}
