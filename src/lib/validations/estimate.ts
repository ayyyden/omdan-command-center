import { z } from "zod"

export const lineItemSchema = z.object({
  id: z.string(),
  description: z.string().min(1, "Description required"),
  quantity: z.number().min(0),
  unit_price: z.number().min(0),
  category: z.enum(["labor", "materials", "subcontractor", "other"]),
  taxable: z.boolean(),
})

export const paymentStepSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Step name required"),
  amount: z.number().min(0),
  description: z.string().optional().or(z.literal("")),
})

export const estimateSchema = z.object({
  customer_id:       z.string().uuid("Select a customer"),
  title:             z.string().min(1, "Title is required"),
  scope_of_work:     z.string().optional().or(z.literal("")),
  manual_total_price: z.number().min(0).optional(),
  line_items:        z.array(lineItemSchema),
  markup_percent:    z.number().min(0).max(100),
  tax_percent:       z.number().min(0).max(100),
  status:            z.enum(["draft", "sent", "approved", "rejected"]),
  notes:             z.string().optional().or(z.literal("")),
  payment_steps:     z.array(paymentStepSchema).optional(),
})

export type EstimateFormValues = z.infer<typeof estimateSchema>
export type PaymentStepValues = z.infer<typeof paymentStepSchema>
