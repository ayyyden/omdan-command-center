import { authorizeMarketing } from "@/lib/marketing-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { attributeMetaLead } from "@/lib/meta-attribution"

export const maxDuration = 300

// POST /api/meta-ads/backfill — attribute existing meta leads that have no
// attribution yet. Meta only returns leads up to 90 days old; older ones
// without UTM ids are marked unattributed and counted as too_old.
export async function POST(req: Request) {
  const auth = await authorizeMarketing(req, "marketing:manage")
  if (auth instanceof Response) return auth
  const service = createServiceClient()
  const { data: leads } = await service
    .from("meta_leads")
    .select("id")
    .is("attribution", null)
    .order("created_at", { ascending: false })
    .limit(400)

  const counts = { checked: 0, leadgen: 0, utm: 0, unattributed: 0, too_old: 0 }
  for (const l of leads ?? []) {
    const r = await attributeMetaLead(service, l.id)
    counts.checked++
    if (!r) continue
    counts[r.attribution]++
    if (r.attribution_note?.includes("90-day")) counts.too_old++
  }
  return Response.json({ ok: true, ...counts, more_remaining: (leads?.length ?? 0) === 400 })
}
