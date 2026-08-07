'use client'
import { Camera } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '@/components/ui/Button'

/**
 * A styled file input. `capture="environment"` opens the rear camera directly on
 * iOS rather than the photo library — what you want standing over a plate or
 * holding a packet.
 *
 * One button, not two. The model classifies plate versus nutrition label itself,
 * so asking first would be a mode switch in front of every photo to save a
 * decision that costs nothing (PRD-003 §3.3).
 */
export function PhotoCaptureButton({
  onFile,
  loading,
}: {
  onFile: (file: File) => void
  loading?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a photo of food or a nutrition label"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          // Reset so picking the same file twice still fires a change event.
          e.target.value = ''
        }}
      />
      <Button
        variant="secondary"
        iconStart={Camera}
        loading={loading}
        onClick={() => input.current?.click()}
      >
        PHOTO
      </Button>
    </>
  )
}
