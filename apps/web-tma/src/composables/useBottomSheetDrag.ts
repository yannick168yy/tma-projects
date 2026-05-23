import { computed, ref, watch, type MaybeRefOrGetter, toValue } from 'vue'

export function useBottomSheetDrag(
  open: MaybeRefOrGetter<boolean>,
  onClose: () => void,
  options?: { dismissPx?: number; dismissRatio?: number },
) {
  const dragY = ref(0)
  const isDragging = ref(false)
  const sheetHeight = ref(0)

  let pointerId: number | null = null
  let startClientY = 0
  let startDragY = 0

  function reset() {
    dragY.value = 0
    isDragging.value = false
    pointerId = null
  }

  watch(
    () => toValue(open),
    (v) => {
      if (!v) reset()
    },
  )

  function measureSheet(el: EventTarget | null) {
    const sheet = (el as HTMLElement | null)?.closest?.('[data-bottom-sheet]') as HTMLElement | null
    sheetHeight.value = sheet?.offsetHeight ?? window.innerHeight * 0.86
  }

  function dismissThreshold() {
    return options?.dismissPx ?? Math.max(96, sheetHeight.value * (options?.dismissRatio ?? 0.2))
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    pointerId = e.pointerId
    el.setPointerCapture(e.pointerId)
    measureSheet(el)
    startClientY = e.clientY
    startDragY = dragY.value
    isDragging.value = true
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging.value || e.pointerId !== pointerId) return
    dragY.value = Math.max(0, startDragY + e.clientY - startClientY)
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerId !== pointerId) return
    const el = e.currentTarget as HTMLElement
    el.releasePointerCapture(e.pointerId)
    pointerId = null
    isDragging.value = false

    if (dragY.value >= dismissThreshold()) {
      dragY.value = sheetHeight.value
      window.setTimeout(() => {
        onClose()
        reset()
      }, 200)
    } else {
      dragY.value = 0
    }
  }

  function onPointerCancel(e: PointerEvent) {
    if (e.pointerId !== pointerId) return
    pointerId = null
    isDragging.value = false
    dragY.value = 0
  }

  const sheetStyle = computed(() => ({
    transform: `translate(-50%, ${dragY.value}px)`,
    transition: isDragging.value ? 'none' : 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
  }))

  const backdropStyle = computed(() => {
    const h = sheetHeight.value || 1
    const fade = Math.min(1, dragY.value / h)
    return { opacity: String(0.7 * (1 - fade * 0.85)) }
  })

  return {
    dragY,
    isDragging,
    sheetStyle,
    backdropStyle,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}
