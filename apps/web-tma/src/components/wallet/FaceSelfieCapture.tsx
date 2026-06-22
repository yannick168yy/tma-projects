import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Loader2, RotateCcw } from 'lucide-react'

interface Props {
  onComplete: (selfieImage: string) => void
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

export default function FaceSelfieCapture({ onComplete, loading }: Props) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [shot, setShot] = useState<string | null>(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }, [])

  const startCamera = useCallback(async () => {
    setStarting(true)
    setCameraError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch {
      setCameraError(t('kyc.cameraDenied'))
    } finally {
      setStarting(false)
    }
  }, [t])

  useEffect(() => {
    void startCamera()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  function capture() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    setShot(canvasToDataUrl(canvas))
    stopCamera()
  }

  function retake() {
    setShot(null)
    void startCamera()
  }

  if (cameraError) {
    return <p className="py-4 text-center text-xs text-red-400">{cameraError}</p>
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] max-h-64 overflow-hidden rounded-xl bg-black">
        {shot ? (
          <img src={shot} alt="selfie" className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
        ) : (
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
        )}
        {starting && !shot && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <Loader2 size={24} className="animate-spin text-white" />
          </div>
        )}
      </div>

      <p className="text-center text-sm font-black text-foreground">{t('kyc.livenessNeutral')}</p>

      {shot ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-secondary py-3 text-sm font-bold text-foreground disabled:opacity-50"
            disabled={loading}
            onClick={retake}
          >
            <RotateCcw size={16} />
            {t('kyc.retake')}
          </button>
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            disabled={loading}
            onClick={() => onComplete(shot)}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : t('kyc.submit')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
          disabled={starting || loading}
          onClick={capture}
        >
          <Camera size={16} />
          {t('kyc.capture')}
        </button>
      )}
    </div>
  )
}
