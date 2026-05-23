import { nextTick, watch, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import { setTelegramBottomSheetSwipeLock } from '@/utils/telegramSwipeLock'

const DRAG_LOCK_PX = 8
const SCROLL_TOP_EPS = 2
const DISMISS_ANIM_MS = 200

const INPUT_SELECTOR = 'input, textarea, select'
const SCROLL_SELECTOR = '[data-sheet-scroll]'

const SHEET_TRANSITION = 'transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)'

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

function isInsideScrollArea(target: EventTarget | null, sheet: HTMLElement): boolean {
  if (!(target instanceof Element)) return false
  const scrollRoot = target.closest(SCROLL_SELECTOR)
  return Boolean(scrollRoot && sheet.contains(scrollRoot))
}

function findClickSuppressEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('button, a, [role="button"]') as HTMLElement | null
}

function getSheetScrollEl(sheet: HTMLElement): HTMLElement | null {
  return sheet.querySelector(SCROLL_SELECTOR)
}

function findScrollEl(target: EventTarget | null, sheet: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element)) return null
  if (!isInsideScrollArea(target, sheet)) return getSheetScrollEl(sheet)

  const scrollRoot = target.closest(SCROLL_SELECTOR) as HTMLElement | null
  if (!scrollRoot) return getSheetScrollEl(sheet)

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

function backdropOpacityForDrag(y: number, height: number): number {
  const fade = Math.min(1, y / (height || 1))
  return 0.7 * (1 - fade * 0.85)
}

export function useBottomSheetDrag(
  open: MaybeRefOrGetter<boolean>,
  onClose: () => void,
  sheetRef: Ref<HTMLElement | null>,
  backdropRef: Ref<HTMLElement | null>,
  options?: { dismissPx?: number; dismissRatio?: number },
) {
  let cachedHeight = 0
  let liveDragY = 0

  let pointerId: number | null = null
  let startClientY = 0
  let startDragY = 0
  let startScrollTop = 0
  let scrollEl: HTMLElement | null = null
  let touchInScrollArea = false
  let sheetDragging = false
  let allowNativeScroll = false
  let clickSuppressEl: HTMLElement | null = null
  let animTimer: ReturnType<typeof setTimeout> | null = null
  let rafId = 0

  function clearAnimTimer() {
    if (animTimer !== null) {
      clearTimeout(animTimer)
      animTimer = null
    }
  }

  function clearSheetVisuals() {
    const sheet = sheetRef.value
    const backdrop = backdropRef.value
    if (sheet) {
      sheet.classList.remove('bottom-sheet--dragging')
      sheet.style.removeProperty('--sheet-drag-y')
      sheet.style.transition = ''
    }
    if (backdrop) {
      backdrop.classList.remove('bottom-sheet--dragging')
      backdrop.style.removeProperty('--sheet-backdrop-opacity')
      backdrop.style.transition = ''
    }
    liveDragY = 0
  }

  function resetGestureState() {
    detachWindowListeners()
    cancelDragFrame()
    pointerId = null
    sheetDragging = false
    allowNativeScroll = false
    scrollEl = null
    touchInScrollArea = false
    startScrollTop = 0
    clickSuppressEl = null
  }

  function reset() {
    clearAnimTimer()
    resetGestureState()
    clearSheetVisuals()
  }

  watch(
    () => toValue(open),
    (v) => {
      setTelegramBottomSheetSwipeLock(v)
      clearAnimTimer()
      resetGestureState()
      if (v) {
        nextTick(() => clearSheetVisuals())
      } else {
        clearSheetVisuals()
      }
    },
    { immediate: true },
  )

  function measureSheet() {
    cachedHeight = sheetRef.value?.offsetHeight ?? window.innerHeight * 0.86
  }

  function dismissThreshold() {
    return options?.dismissPx ?? Math.max(96, cachedHeight * (options?.dismissRatio ?? 0.2))
  }

  function detachWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
  }

  function cancelDragFrame() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  function paintDrag(y: number) {
    liveDragY = y
    const sheet = sheetRef.value
    const backdrop = backdropRef.value
    if (sheet) {
      sheet.classList.add('bottom-sheet--dragging')
      sheet.style.setProperty('--sheet-drag-y', `${y}px`)
    }
    if (backdrop) {
      backdrop.classList.add('bottom-sheet--dragging')
      backdrop.style.setProperty('--sheet-backdrop-opacity', String(backdropOpacityForDrag(y, cachedHeight)))
    }
  }

  function schedulePaint(y: number) {
    liveDragY = y
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      paintDrag(liveDragY)
    })
  }

  function flushPaint(y: number) {
    cancelDragFrame()
    paintDrag(y)
  }

  function beginSheetDrag(sheet: HTMLElement, e: PointerEvent, dragOffset = 0) {
    if (sheetDragging) return
    sheetDragging = true
    allowNativeScroll = false
    try {
      sheet.setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    if (dragOffset > 0) schedulePaint(dragOffset)
  }

  /** Pull down from header/filters: scroll list toward top before sheet drag. */
  function pullScrollTowardTop(pulledPx: number): number {
    if (!scrollEl || pulledPx <= 0) return pulledPx
    const nextTop = Math.max(0, startScrollTop - pulledPx)
    scrollEl.scrollTop = nextTop
    const consumed = startScrollTop - nextTop
    return Math.max(0, pulledPx - consumed)
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
    if (isTextInput(e.target)) return

    clearAnimTimer()
    measureSheet()
    scrollEl = findScrollEl(e.target, sheet)
    touchInScrollArea = isInsideScrollArea(e.target, sheet)
    startScrollTop = scrollEl?.scrollTop ?? 0
    clickSuppressEl = findClickSuppressEl(e.target)
    startClientY = e.clientY
    startDragY = liveDragY
    pointerId = e.pointerId
    sheetDragging = false
    allowNativeScroll = false

    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
  }

  function handleScrollHandoff(sheet: HTMLElement, e: PointerEvent, dy: number) {
    const pulled = Math.max(0, dy - DRAG_LOCK_PX)
    const st = scrollEl!.scrollTop

    if (allowNativeScroll) {
      if (st <= SCROLL_TOP_EPS && dy > 0) {
        beginSheetDrag(sheet, e, pulled)
        if (e.cancelable) e.preventDefault()
      }
      return
    }

    if (dy < 0) {
      allowNativeScroll = true
      return
    }

    if (dy > 0 && st > SCROLL_TOP_EPS) {
      if (touchInScrollArea) {
        allowNativeScroll = true
        return
      }
      const excess = pullScrollTowardTop(pulled)
      if (scrollEl!.scrollTop <= SCROLL_TOP_EPS) {
        beginSheetDrag(sheet, e, excess)
        if (e.cancelable) e.preventDefault()
      }
      return
    }

    if (dy > 0 && st <= SCROLL_TOP_EPS) {
      beginSheetDrag(sheet, e, pulled)
      if (e.cancelable) e.preventDefault()
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    const sheet = sheetRef.value
    if (!sheet) return

    const dy = e.clientY - startClientY

    if (sheetDragging) {
      if (e.cancelable) e.preventDefault()
      schedulePaint(Math.max(0, startDragY + dy))
      return
    }

    if (Math.abs(dy) < DRAG_LOCK_PX) return

    if (!scrollEl || !isScrollable(scrollEl)) {
      if (dy > 0) {
        beginSheetDrag(sheet, e, Math.max(0, dy - DRAG_LOCK_PX))
        if (e.cancelable) e.preventDefault()
      }
      return
    }

    handleScrollHandoff(sheet, e, dy)
  }

  function releaseCapture(sheet: HTMLElement | null, id: number) {
    if (sheet?.hasPointerCapture(id)) {
      try {
        sheet.releasePointerCapture(id)
      } catch {
        // ignore
      }
    }
  }

  function animateTo(y: number, onDone?: () => void) {
    clearAnimTimer()
    const sheet = sheetRef.value
    const backdrop = backdropRef.value
    paintDrag(y)
    if (sheet) sheet.style.transition = SHEET_TRANSITION
    if (backdrop) backdrop.style.transition = 'opacity 0.28s cubic-bezier(0.32, 0.72, 0, 1)'

    let done = false
    const finish = () => {
      if (done) return
      done = true
      sheet?.removeEventListener('transitionend', onTransitionEnd)
      onDone?.()
    }
    const onTransitionEnd = (ev: TransitionEvent) => {
      if (ev.propertyName !== 'transform') return
      finish()
    }
    sheet?.addEventListener('transitionend', onTransitionEnd)
    animTimer = setTimeout(finish, DISMISS_ANIM_MS + 50)
  }

  function onPointerUp(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    detachWindowListeners()

    const sheet = sheetRef.value
    releaseCapture(sheet, e.pointerId)

    const dy = e.clientY - startClientY
    if (sheetDragging) {
      flushPaint(Math.max(0, startDragY + dy))
    } else {
      cancelDragFrame()
    }

    const didMove = Math.abs(dy) > DRAG_LOCK_PX || liveDragY > DRAG_LOCK_PX
    const wasSheetDrag = sheetDragging
    const finalY = liveDragY

    pointerId = null
    sheetDragging = false
    allowNativeScroll = false
    touchInScrollArea = false

    suppressClickIfNeeded(wasSheetDrag || (didMove && finalY > 0))

    if (!wasSheetDrag) return

    if (finalY >= dismissThreshold()) {
      clearAnimTimer()
      animateTo(cachedHeight, () => {
        clearAnimTimer()
        onClose()
        reset()
      })
    } else {
      animateTo(0, () => clearSheetVisuals())
    }
  }

  function onPointerCancel(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    detachWindowListeners()
    cancelDragFrame()
    releaseCapture(sheetRef.value, e.pointerId)
    suppressClickIfNeeded(sheetDragging)
    resetGestureState()
    animateTo(0, () => clearSheetVisuals())
  }

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
  }
}
