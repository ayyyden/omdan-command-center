import { NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { buildEstimatePdf, estimateFileName } from "@/lib/estimate-delivery"

// GET /api/estimates/public-pdf/[token] — the client's "Download PDF" on the
// approval page (public, by the estimate's approval token). Same PDF as the
// email attachment; the signed version once they've signed.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()
  const { data: row } = await supabase.from("estimates").select("id").eq("approval_token", token).maybeSingle()
  if (!row) return new Response("Not found", { status: 404 })

  const { buffer, number, est } = await buildEstimatePdf(row.id, { supabase, appUrl: req.nextUrl.origin })
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${estimateFileName(number, !!est.signed_at)}"`,
      "Cache-Control": "no-store",
    },
  })
}
