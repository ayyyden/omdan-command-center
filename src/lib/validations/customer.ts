import { z } from "zod"

export const customerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional().or(z.literal("")),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  service_type: z.string().optional().or(z.literal("")),
  lead_source: z.string().optional(),
  status: z.enum(["New Lead","Contacted","Estimate Sent","Follow-Up Needed","Approved","Scheduled","In Progress","Completed","Paid","Closed Lost"]),
  notes: z.string().optional().or(z.literal("")),
})

export type CustomerFormValues = z.infer<typeof customerSchema>
