'use client'
import { Camera, ImageUp } from 'lucide-react'
import { useRef, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/Button'

/**
 * Two file inputs, one pipeline.
 *
 * `capture="environment"` opens the rear camera on iOS — what you want standing
 * over a plate. Without `capture`, the same accept opens the photo library —
 * PRD-002's `capture / pick`. Both hand a `File` to `prepareImage`; the model
 * still classifies plate versus label itself (PRD-003 §3.3).
 */
export function PhotoCaptureButton({
  onFile,
  loading,
}: {
  onFile: (file: File) => void
  loading?: boolean
}) {
  const camera = useRef<HTMLInputElement>(null)
  const library = useRef<HTMLInputElement>(null)

  const take = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
    // Reset so picking the same file twice still fires a change event.
    e.target.value = ''
  }

  return (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a photo of food or a nutrition label"
        className="sr-only"
        onChange={take}
      />
      <input
        ref={library}
        type="file"
        accept="image/*"
        aria-label="Upload a photo of food or a nutrition label"
        className="sr-only"
        onChange={take}
      />
      <div className="flex shrink-0 gap-2">
        <Button
          variant="secondary"
          iconStart={Camera}
          loading={loading}
          onClick={() => camera.current?.click()}
        >
          PHOTO
        </Button>
        <Button
          variant="secondary"
          iconStart={ImageUp}
          loading={loading}
          onClick={() => library.current?.click()}
        >
          UPLOAD
        </Button>
      </div>
    </>
  )
}
