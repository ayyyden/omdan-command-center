// Shared constants for the classic/studio design switch (see
// src/components/providers/design-switch.tsx). Kept out of the client
// module so the server root layout can inline the boot script.

export type Design = "studio" | "classic"
export const DESIGN_KEY = "omdan-design"

// Sets <html data-design> before first paint (no flash). Studio is the default.
export const DESIGN_BOOT_SCRIPT = `try{var d=localStorage.getItem('${DESIGN_KEY}')||'studio';document.documentElement.setAttribute('data-design',d)}catch(e){document.documentElement.setAttribute('data-design','studio')}`
