import { z } from "zod"

export const lineItemSchema = z.object({
  id: z.string(),
  description: z.string().min(1, "Description required"),
  quantity: z.number().min(0),
  unit_price: z.number().min(0),
  category: z.enum(["labor", "materials", "subcontractor", "other"]),
  taxable: z.boolean(),
})

export const estimateSchema = z.object({
  customer_id: z.string().uuid("Select a customer"),
  title: z.string().min(1, "Title is required"),
  scope_of_work: z.string().optional().or(z.literal("")),
  line_items: z.array(lineItemSchema).min(1, "Add at least one line item"),
  markup_percent: z.number().min(0).max(100),
  tax_percent: z.number().min(0).max(100),
  status: z.enum(["draft", "sent", "approved", "rejected"]),
  notes: z.string().optional().or(z.literal("")),
})

export type EstimateFormValues = z.infer<typeof estimateSchema>
