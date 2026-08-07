/**
 * Client-side image preparation. Pure geometry plus one canvas call.
 *
 * Downscaling is not politeness — a 64×64 PNG measured 1,089 prompt tokens, so a
 * full-resolution phone photo would be enormous and slow on mobile data
 * (PRD-001 §2.2, PRD-003 §3.3).
 */
export const MAX_EDGE = 1024
export const JPEG_QUALITY = 0.8

/** Fits inside a square of `maxEdge` without upscaling or changing aspect. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export const stripDataUrl = (dataUrl: string): string => dataUrl.replace(/^data:[^;]+;base64,/, '')

/** Rough byte size of a base64 payload, for the upload guard. */
export const base64Bytes = (b64: string): number => Math.floor((b64.length * 3) / 4)

/**
 * Reads a File, downscales it, and returns bare base64 JPEG.
 *
 * Browser-only — uses createImageBitmap and canvas.
 */
export async function prepareImage(
  file: File,
  maxEdge = MAX_EDGE,
): Promise<{ base64: string; mimeType: 'image/jpeg'; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return { base64: stripDataUrl(dataUrl), mimeType: 'image/jpeg', width, height }
}
