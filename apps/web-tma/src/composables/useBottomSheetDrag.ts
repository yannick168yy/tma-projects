import { nextTick, watch, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import { setTelegramBottomSheetSwipeLock } from '@/utils/telegramSwipeLock'

const DRAG_LOCK_PX = 8
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

function findClickSuppressEl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest('button, a, [role="button"]') as HTMLElement | null
}

function getSheetScrollEl(sheet: HTMLElement | null): HTMLElement | null {
  return sheet?.querySelector(SCROLL_SELECTOR) ?? null
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

  let scrollEl: HTMLElement | null = null

  let pointerId: number | null = null
  let pointerZone: 'chrome' | 'scroll' | null = null
  let startClientY = 0
  let startScrollTop = 0
  let sheetDragging = false
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
      for (const el of sheet.querySelectorAll('[data-sheet-chrome], [data-sheet-scroll]')) {
        ;(el as HTMLElement).style.transition = ''
      }
    }
    if (backdrop) {
      backdrop.classList.remove('bottom-sheet--dragging')
      backdrop.style.removeProperty('--sheet-backdrop-opacity')
      backdrop.style.transition = ''
    }
    liveDragY = 0
  }

  function detachChromeListeners() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  }

  function resetGestureState() {
    detachChromeListeners()
    cancelDragFrame()
    pointerId = null
    pointerZone = null
    sheetDragging = false
    startScrollTop = 0
    clickSuppressEl = null
    scrollEl = null
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

  function cancelDragFrame() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  /** Drag offset on chrome + scroll siblings — NOT on sheet root (keeps list scrollable on iOS). */
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

  function releaseCapture(sheet: HTMLElement | null, id: number) {
    if (sheet?.hasPointerCapture(id)) {
      try {
        sheet.releasePointerCapture(id)
      } catch {
        // ignore
      }
    }
  }

  function suppressClickIfNeeded(el: HTMLElement | null, didDrag: boolean) {
    if (!el || !didDrag) return
    const block = (ev: Event) => {
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }
    el.addEventListener('click', block, { capture: true, once: true })
  }

  function finishSheetDrag(wasSheetDrag: boolean) {
    if (!wasSheetDrag) {
      animateTo(0, () => clearSheetVisuals())
      return
    }
    if (liveDragY >= dismissThreshold()) {
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

  function applyPullDownFromTop(pulled: number, startTop: number) {
    if (!scrollEl || pulled <= 0) return 0
    const scrollReduce = Math.min(startTop, pulled)
    scrollEl.scrollTop = Math.max(0, startTop - scrollReduce)
    return pulled - scrollReduce
  }

  function beginPointerGesture(e: PointerEvent, zone: 'chrome' | 'scroll') {
    if (e.button !== 0) return
    const sheet = sheetRef.value
    if (!sheet) return
    if (isTextInput(e.target)) return

    clearAnimTimer()
    measureSheet()
    scrollEl = getSheetScrollEl(sheet)
    startScrollTop = scrollEl?.scrollTop ?? 0
    clickSuppressEl = findClickSuppressEl(e.target)
    startClientY = e.clientY
    pointerId = e.pointerId
    pointerZone = zone
    sheetDragging = false

    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  function onChromePointerDown(e: PointerEvent) {
    beginPointerGesture(e, 'chrome')
  }

  function onScrollPointerDown(e: PointerEvent) {
    beginPointerGesture(e, 'scroll')
  }

  /** Scroll zone: never block upward moves — native inertia must run. */
  function shouldDeferToNativeScroll(dy: number): boolean {
    if (pointerZone !== 'scroll' || !scrollEl) return false
    if (dy < -DRAG_LOCK_PX) return true
    if (scrollEl.scrollTop > 1 && dy > 0) return true
    return false
  }

  function onPointerMove(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    const sheet = sheetRef.value
    if (!sheet) return

    const dy = e.clientY - startClientY
    if (shouldDeferToNativeScroll(dy)) return
    if (dy <= DRAG_LOCK_PX) return

    if (scrollEl && isScrollable(scrollEl)) {
      const pulled = dy - DRAG_LOCK_PX
      const atTop = scrollEl.scrollTop <= 1
      const sheetPull = atTop ? pulled : applyPullDownFromTop(pulled, startScrollTop)
      if (sheetPull > 0) {
        if (!sheetDragging) {
          sheetDragging = true
          try {
            sheet.setPointerCapture(e.pointerId)
          } catch {
            // ignore
          }
        }
        if (e.cancelable) e.preventDefault()
        schedulePaint(sheetPull)
        return
      }
      if (pulled > 0 && startScrollTop > 0 && pointerZone === 'chrome') {
        if (e.cancelable) e.preventDefault()
        return
      }
    }

    if (dy > DRAG_LOCK_PX) {
      if (!sheetDragging) {
        sheetDragging = true
        try {
          sheet.setPointerCapture(e.pointerId)
        } catch {
          // ignore
        }
      }
      if (e.cancelable) e.preventDefault()
      schedulePaint(dy - DRAG_LOCK_PX)
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return
    detachChromeListeners()

    const sheet = sheetRef.value
    const dy = e.clientY - startClientY
    const didMove = Math.abs(dy) > DRAG_LOCK_PX || liveDragY > DRAG_LOCK_PX
    const wasSheetDrag = liveDragY > DRAG_LOCK_PX

    if (sheetDragging && wasSheetDrag) flushPaint(liveDragY)
    else cancelDragFrame()

    releaseCapture(sheet, e.pointerId)
    pointerId = null
    sheetDragging = false

    suppressClickIfNeeded(clickSuppressEl, wasSheetDrag || didMove)
    clickSuppressEl = null

    if (!wasSheetDrag) return
    finishSheetDrag(true)
  }

  function animateTo(y: number, onDone?: () => void) {
    clearAnimTimer()
    const sheet = sheetRef.value
    const backdrop = backdropRef.value
    paintDrag(y)
    if (sheet) {
      for (const el of sheet.querySelectorAll('[data-sheet-chrome], [data-sheet-scroll]')) {
        ;(el as HTMLElement).style.transition = SHEET_TRANSITION
      }
    }
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

  return {
    onChromePointerDown,
    onScrollPointerDown,
    onChromePointerUp: onPointerUp,
    onScrollPointerUp: onPointerUp,
  }
}
