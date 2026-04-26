const MAX_PX      = 1280
const QUALITY     = 0.7
const MAX_BYTES   = 2 * 1024 * 1024
const COMPRESSIBLE = /^image\/(jpeg|jpg|png|webp|bmp|tiff)/

/**
 * Resize + convert to JPEG at 0.7 quality, max 1280 px wide.
 * Returns the original file unchanged for PDFs, GIFs, SVGs, etc.
 * Throws with a human-readable message if the result exceeds 2 MB.
 */
export async function compressImage(file: File): Promise<File> {
  if (!COMPRESSIBLE.test(file.type)) return file

  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      let w = img.naturalWidth
      let h = img.naturalHeight

      if (w > MAX_PX) {
        h = Math.round((h * MAX_PX) / w)
        w = MAX_PX
      }

      const canvas = document.createElement("canvas")
      canvas.width  = w
      canvas.height = h
      const ctx = canvas.getContext("2d")
      if (!ctx) { reject(new Error("Canvas unavailable")); return }
      ctx.drawImage(img, 0, 0, w, h)

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error("Image compression failed")); return }

          if (blob.size > MAX_BYTES) {
            reject(
              new Error(
                `Image is still ${(blob.size / 1024 / 1024).toFixed(1)} MB after compression (max 2 MB). ` +
                "Please use a smaller image."
              )
            )
            return
          }

          const base    = file.name.replace(/\.[^.]+$/, "")
          const newName = `${base}.jpg`
          resolve(new File([blob], newName, { type: "image/jpeg" }))
        },
        "image/jpeg",
        QUALITY
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("Failed to load image for compression"))
    }

    img.src = objectUrl
  })
}
