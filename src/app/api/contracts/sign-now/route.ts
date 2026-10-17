import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { prepareDocumentsForRecipient, type DocumentToSend } from "@/lib/contracts/prepare-signing"

// "Sign now" — staff hands the device to the customer right there instead of
// emailing a link. Creates the same sent_contracts/bundle records the email
// flow would, minus the email, and hands the browser straight to the
// signing token so the caller can navigate into /sign-contract or
// /sign-bundle immediately.
export async function POST(req: NextRequest) {
  const { contractId, documents: docsIn, customerId, jobId, recipientEmail, staffFieldValues } = await req.json() as {
    contractId?:      string
    documents?:       DocumentToSend[]
    customerId:       string
    jobId:            string | null
    recipientEmail:   string
    staffFieldValues?: Record<string, string> | null
  }

  const documents: DocumentToSend[] = docsIn?.length ? docsIn : contractId ? [{ templateId: contractId, staffFieldValues }] : []
  if (!documents.length || !customerId || !recipientEmail) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const session = await requirePermission("contracts:send")
  if (session instanceof Response) return session
  const { userId, supabase } = session

  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .single()
  if (custErr || !customer) return Response.json({ error: "Customer not found" }, { status: 404 })

  try {
    const result = await prepareDocumentsForRecipient({
      supabase, userId, documents, customerId, jobId: jobId ?? null,
      recipientEmail,
      subject: "Signed in person",
      body: "",
    })

    return Response.json({
      success:  true,
      token:    result.token,
      isBundle: result.isBundle,
    })
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "Could not prepare document" }, { status: 500 })
  }
}
