import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Check, Loader2 } from 'lucide-react'
import type { LivenessAction } from '@/api/kyc'

const STEPS: LivenessAction[] = ['neutral', 'blink', 'mouth']

interface Props {
  onComplete: (frames: Array<{ action: LivenessAction; image: string }>) => void
  loading?: boolean
}

function canvasToDataUrl(canvas: HTMLCanvasElement, maxDim = 1280, quality = 0.82): string {
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height))
  if (scale >= 1) return canvas.toDataURL('image/jpeg', quality)
  const out = document.createElement('canvas')
  out.width = Math.round(canvas.width * scale)
  out.height = Math.round(canvas.height * scale)
  const ctx = out.getContext('2d')
  if (!ctx) return canvas.toDataURL('image/jpeg', quality)
  ctx.drawImage(canvas, 0, 0, out.width, out.height)
  return out.toDataURL('image/jpeg', quality)
}

export default function FaceLivenessCapture({ onComplete, loading }: Props) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [frames, setFrames] = useState<Array<{ action: LivenessAction; image: string }>>([])
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)

  const currentAction = STEPS[stepIdx]

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    async function start() {
      setStarting(true)
      setCameraError(null)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch {
        if (!cancelled) setCameraError(t('kyc.cameraDenied'))
      } finally {
        if (!cancelled) setStarting(false)
      }
    }
    void start()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [stopCamera, t])

  function captureFrame() {
    const video = videoRef.current
    if (!video || !currentAction) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = canvasToDataUrl(canvas)
    const next = [...frames, { action: currentAction, image }]
    setFrames(next)
    if (stepIdx + 1 >= STEPS.length) {
      stopCamera()
      onComplete(next)
    } else {
      setStepIdx(stepIdx + 1)
    }
  }

  const hintKey = currentAction === 'neutral'
    ? 'kyc.livenessNeutral'
    : currentAction === 'blink'
      ? 'kyc.livenessBlink'
      : 'kyc.livenessMouth'

  if (cameraError) {
    return <p className="text-center text-xs text-red-400 py-4">{cameraError}</p>
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl bg-black aspect-[3/4] max-h-64">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        {starting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Loader2 size={24} className="animate-spin text-white" />
          </div>
        )}
      </div>

      <p className="text-center text-sm font-black text-foreground">{t(hintKey)}</p>
      <p className="text-center text-[10px] text-muted-foreground">
        {stepIdx + 1} / {STEPS.length}
      </p>

      <button
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
        disabled={starting || loading || !!cameraError}
        onClick={captureFrame}
      >
        {loading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : frames.length >= STEPS.length ? (
          <Check size={16} />
        ) : (
          <Camera size={16} />
        )}
        {loading ? t('kyc.submit') : t('kyc.capture')}
      </button>
    </div>
  )
}
