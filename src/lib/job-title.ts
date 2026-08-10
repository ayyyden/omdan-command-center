// Shared job-title logic: a job's title is always the street portion of its
// customer's address when one is on file — never a service type or estimate
// title. Used at every job-creation site plus the one-time backfill of
// existing jobs.

export function streetFromAddress(address: string | null | undefined): string {
  if (!address) return ""
  const comma = address.indexOf(",")
  return (comma > 0 ? address.slice(0, comma) : address).trim()
}

/**
 * Derives a job's title from a customer address, falling back to the given
 * value (service type, estimate title, etc.) only when there's no usable
 * address.
 */
export function deriveJobTitle(address: string | null | undefined, fallback: string): string {
  const street = streetFromAddress(address)
  return street || fallback
}
