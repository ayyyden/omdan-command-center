import { z } from "zod"

export const projectManagerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  is_active: z.boolean(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color"),
})

export type ProjectManagerFormValues = z.infer<typeof projectManagerSchema>
