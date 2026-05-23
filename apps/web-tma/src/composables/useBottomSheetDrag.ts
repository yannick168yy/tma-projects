import { computed, ref, watch, type MaybeRefOrGetter, type Ref, toValue } from 'vue'

/** Movement before locking to scroll vs sheet-drag vs tap. */
const DRAG_LOCK_PX = 8
const SCROLL_TOP_EPS = 2

const INPUT_SELECTOR = 'input, textarea, select'

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const el = target.closest(INPUT_SELECTOR)
  if (!el) return false
  if (el instanceof HTMLInputElement) {
    const t = el.type
    if (t === 'button' || t === 'submit' || t === 'reset') return false
  }
  return true
}

function findClickSuppressEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('button, a, [role="button"]') as HTMLElement | null
}

function findScrollEl(target: EventTarget | null, sheet: HTMLElement): HTMLElement | null {
  let node = target instanceof HTMLElement ? target : null
  while (node && node !== sheet) {
    if (node.hasAttribute('data-sheet-scroll')) return node
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node
    }
    node = node.parentElement
  }
  return sheet.querySelector('[data-sheet-scroll]')
}

function isScrollable(el: HTMLElement | null): boolean {
  if (!el) return false
  return el.scrollHeight > el.clientHeight + 1
}

export function useBottomSheetDrag(
  open: MaybeRefOrGetter<boolean>,
  onClose: () => void,
  sheetRef: Ref<HTMLElement | null>,
  options?: { dismissPx?: number; dismissRatio?: number },
) {
  const dragY = ref(0)
  const isDragging = ref(false)
  const sheetHeight = ref(0)

  let pointerId: number | null = null
  let startClientY = 0
  let startDragY = 0
  let scrollEl: HTMLElement | null = null
  let sheetDragging = false
  let allowScroll = false
  let clickSuppressEl: HTMLElement | null = null

  function reset() {
    detachWindowListeners()
    dragY.value = 0
    isDragging.value = false
    pointerId = null
    sheetDragging = false
    allowScroll = false
    scrollEl = null
    clickSuppressEl = null
  }

  watch(
    () => toValue(open),
    (v) => {
      if (!v) reset()
    },
  )

  function measureSheet() {
    sheetHeight.value = sheetRef.value?.offsetHeight ?? window.innerHeight * 0.86
  }

  function dismissThreshold() {
    return options?.dismissPx ?? Math.max(96, sheetHeight.value * (options?.dismissRatio ?? 0.2))
  }

  function detachWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
  }

  function beginSheetDrag(sheet: HTMLElement, e: PointerEvent) {
    sheetDragging = true
    isDragging.value = true
    allowScroll = false
    sheet.setPointerCapture(e.pointerId)
    if (scrollEl) scrollEl.scrollTop = 0
  }

  function suppressClickIfNeeded(didDrag: boolean) {
    if (!clickSuppressEl || !didDrag) {
      clickSuppressEl = null
      return
    }
    const el = clickSuppressEl
    const block = (ev: Event) => {
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }
    el.addEventListener('click', block, { capture: true, once: true })
    clickSuppressEl = null
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const sheet = sheetRef.value
    if (!sheet || !sheet.contains(e.target as Node)) return

    // Search input etc. — keep focus/typing; everything else can start a drag
    if (isTextInput(e.target)) return

    measureSheet()
    scrollEl = findScrollEl(e.target, sheet)
    clickSuppressEl = findClickSuppressEl(e.target)
    startClientY = e.clientY
    startDragY = dragY.value
    pointerId = e.pointerId
    sheetDragging = false
    allowScroll = false
    isDragging.value = false

    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
  }

  function onPointerMove(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    const sheet = sheetRef.value
    if (!sheet) return

    const dy = e.clientY - startClientY

    if (sheetDragging) {
      e.preventDefault()
      dragY.value = Math.max(0, startDragY + dy)
      return
    }

    if (Math.abs(dy) < DRAG_LOCK_PX) return

    // Was scrolling list — at top, keep pulling down → drag whole sheet
    if (allowScroll && scrollEl) {
      if (scrollEl.scrollTop <= SCROLL_TOP_EPS && dy > 0) {
        beginSheetDrag(sheet, e)
        e.preventDefault()
        dragY.value = Math.max(0, dy)
      }
      return
    }

    if (!isScrollable(scrollEl)) {
      if (dy > 0) {
        beginSheetDrag(sheet, e)
        e.preventDefault()
        dragY.value = Math.max(0, dy)
      }
      return
    }

    const st = scrollEl!.scrollTop

    if (dy < 0) {
      allowScroll = true
      return
    }

    if (dy > 0 && st > SCROLL_TOP_EPS) {
      allowScroll = true
      return
    }

    if (dy > 0 && st <= SCROLL_TOP_EPS) {
      beginSheetDrag(sheet, e)
      e.preventDefault()
      dragY.value = Math.max(0, dy)
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    detachWindowListeners()

    const sheet = sheetRef.value
    if (sheet?.hasPointerCapture(e.pointerId)) {
      sheet.releasePointerCapture(e.pointerId)
    }

    const dy = e.clientY - startClientY
    const didMove = Math.abs(dy) > DRAG_LOCK_PX || dragY.value > DRAG_LOCK_PX
    const wasSheetDrag = sheetDragging

    pointerId = null
    sheetDragging = false
    allowScroll = false
    isDragging.value = false

    suppressClickIfNeeded(wasSheetDrag || (didMove && dragY.value > 0))

    if (!wasSheetDrag) return

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
    if (pointerId === null || e.pointerId !== pointerId) return
    detachWindowListeners()
    const sheet = sheetRef.value
    if (sheet?.hasPointerCapture(e.pointerId)) {
      sheet.releasePointerCapture(e.pointerId)
    }
    suppressClickIfNeeded(sheetDragging)
    reset()
  }

  const sheetStyle = computed(() => ({
    transform: `translate(-50%, ${dragY.value}px)`,
    transition: isDragging.value ? 'none' : 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)',
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
