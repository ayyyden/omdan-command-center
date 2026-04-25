import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { data: sent } = await supabase
    .from("sent_contracts")
    .select("signed_pdf_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (!sent?.signed_pdf_path) return Response.json({ error: "Not found" }, { status: 404 })

  const { data: urlData } = await supabase.storage
    .from("files")
    .createSignedUrl(sent.signed_pdf_path, 3600)

  if (!urlData?.signedUrl) return Response.json({ error: "Could not generate URL" }, { status: 500 })

  return Response.json({ url: urlData.signedUrl })
}
