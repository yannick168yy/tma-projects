import { computed, ref, watch, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import { setTelegramBottomSheetSwipeLock } from '@/utils/telegramSwipeLock'

/** Movement before locking to scroll vs sheet-drag vs tap. */
const DRAG_LOCK_PX = 8
const SCROLL_TOP_EPS = 2

const INPUT_SELECTOR = 'input, textarea, select'
const SCROLL_SELECTOR = '[data-sheet-scroll]'
const DRAG_HANDLE_SELECTOR = '[data-sheet-drag]'

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

function isDragHandle(target: EventTarget | null, sheet: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  const handle = target.closest(DRAG_HANDLE_SELECTOR)
  return Boolean(handle && sheet.contains(handle))
}

function isInsideScrollArea(target: EventTarget | null, sheet: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  const scrollRoot = target.closest(SCROLL_SELECTOR)
  return Boolean(scrollRoot && sheet.contains(scrollRoot))
}

function findClickSuppressEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('button, a, [role="button"]') as HTMLElement | null
}

/** Scroll container only when the pointer started inside [data-sheet-scroll]. */
function findScrollEl(target: EventTarget | null, sheet: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null
  if (!isInsideScrollArea(target, sheet)) return null

  const scrollRoot = target.closest(SCROLL_SELECTOR) as HTMLElement | null
  if (!scrollRoot) return null

  let node: HTMLElement | null = target instanceof HTMLElement ? target : null
  while (node && node !== scrollRoot) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node
    }
    node = node.parentElement
  }
  return scrollRoot
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
  let outsideScroll = false
  let dragHandle = false

  function reset() {
    detachWindowListeners()
    dragY.value = 0
    isDragging.value = false
    pointerId = null
    sheetDragging = false
    allowScroll = false
    scrollEl = null
    clickSuppressEl = null
    outsideScroll = false
    dragHandle = false
  }

  watch(
    () => toValue(open),
    (v) => {
      setTelegramBottomSheetSwipeLock(v)
      if (!v) reset()
    },
    { immediate: true },
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
    window.removeEventListener('touchmove', onTouchMove)
  }

  function beginSheetDrag(sheet: HTMLElement, e: PointerEvent) {
    sheetDragging = true
    isDragging.value = true
    allowScroll = false
    try {
      sheet.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
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

  function onTouchMove(e: TouchEvent) {
    if (!sheetDragging) return
    if (e.cancelable) e.preventDefault()
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const sheet = sheetRef.value
    if (!sheet || !sheet.contains(e.target as Node)) return

    if (isTextInput(e.target)) return

    measureSheet()
    scrollEl = findScrollEl(e.target, sheet)
    outsideScroll = scrollEl === null
    dragHandle = isDragHandle(e.target, sheet)
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
    window.addEventListener('touchmove', onTouchMove, { passive: false })
  }

  function onPointerMove(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    const sheet = sheetRef.value
    if (!sheet) return

    const dy = e.clientY - startClientY

    if (sheetDragging) {
      if (e.cancelable) e.preventDefault()
      dragY.value = Math.max(0, startDragY + dy)
      return
    }

    if (Math.abs(dy) < DRAG_LOCK_PX) return

    // Tabs, filters, search header — not tied to list scroll position
    if (outsideScroll) {
      if (dy > 0) {
        beginSheetDrag(sheet, e)
        if (e.cancelable) e.preventDefault()
        dragY.value = Math.max(0, dy)
      }
      return
    }

    // Pay / game tiles: pull down closes sheet; pull up scrolls list
    if (dragHandle) {
      if (dy > 0) {
        beginSheetDrag(sheet, e)
        if (e.cancelable) e.preventDefault()
        dragY.value = Math.max(0, dy)
      } else if (dy < 0) {
        allowScroll = true
      }
      return
    }

    if (allowScroll && scrollEl) {
      if (scrollEl.scrollTop <= SCROLL_TOP_EPS && dy > 0) {
        beginSheetDrag(sheet, e)
        if (e.cancelable) e.preventDefault()
        dragY.value = Math.max(0, dy)
      }
      return
    }

    if (!isScrollable(scrollEl)) {
      if (dy > 0) {
        beginSheetDrag(sheet, e)
        if (e.cancelable) e.preventDefault()
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
      if (e.cancelable) e.preventDefault()
      dragY.value = Math.max(0, dy)
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    detachWindowListeners()

    const sheet = sheetRef.value
    if (sheet?.hasPointerCapture(e.pointerId)) {
      try {
        sheet.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }

    const dy = e.clientY - startClientY
    const didMove = Math.abs(dy) > DRAG_LOCK_PX || dragY.value > DRAG_LOCK_PX
    const wasSheetDrag = sheetDragging

    pointerId = null
    sheetDragging = false
    allowScroll = false
    outsideScroll = false
    dragHandle = false
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
      try {
        sheet.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
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
