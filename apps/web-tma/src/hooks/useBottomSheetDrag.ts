import { useEffect, useRef } from 'react'
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
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node
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
  open: boolean,
  onClose: () => void,
  sheetRef: React.RefObject<HTMLElement | null>,
  backdropRef: React.RefObject<HTMLElement | null>,
  options?: { dismissPx?: number; dismissRatio?: number },
) {
  const stateRef = useRef({
    cachedHeight: 0,
    liveDragY: 0,
    pointerId: null as number | null,
    startClientY: 0,
    startDragY: 0,
    startScrollTop: 0,
    scrollEl: null as HTMLElement | null,
    touchInScrollArea: false,
    sheetDragging: false,
    allowNativeScroll: false,
    clickSuppressEl: null as HTMLElement | null,
    animTimer: null as ReturnType<typeof setTimeout> | null,
    rafId: 0,
  })

  useEffect(() => {
    setTelegramBottomSheetSwipeLock(open)
    const s = stateRef.current
    if (s.animTimer) clearTimeout(s.animTimer)
    s.animTimer = null
    s.pointerId = null
    s.sheetDragging = false
    s.allowNativeScroll = false
    s.scrollEl = null
    s.touchInScrollArea = false
    s.startScrollTop = 0
    s.clickSuppressEl = null
    if (s.rafId) cancelAnimationFrame(s.rafId)
    s.rafId = 0
    const sheet = sheetRef.current
    const backdrop = backdropRef.current
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
    s.liveDragY = 0
  }, [open, sheetRef, backdropRef])

  function dismissThreshold() {
    const s = stateRef.current
    return options?.dismissPx ?? Math.max(96, s.cachedHeight * (options?.dismissRatio ?? 0.2))
  }

  function paintDrag(y: number) {
    const s = stateRef.current
    s.liveDragY = y
    const sheet = sheetRef.current
    const backdrop = backdropRef.current
    if (sheet) {
      sheet.classList.add('bottom-sheet--dragging')
      sheet.style.setProperty('--sheet-drag-y', `${y}px`)
    }
    if (backdrop) {
      backdrop.classList.add('bottom-sheet--dragging')
      backdrop.style.setProperty('--sheet-backdrop-opacity', String(backdropOpacityForDrag(y, s.cachedHeight)))
    }
  }

  function schedulePaint(y: number) {
    const s = stateRef.current
    s.liveDragY = y
    if (s.rafId) return
    s.rafId = requestAnimationFrame(() => {
      s.rafId = 0
      paintDrag(s.liveDragY)
    })
  }

  function flushPaint(y: number) {
    const s = stateRef.current
    if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = 0 }
    paintDrag(y)
  }

  function animateTo(y: number, onDone?: () => void) {
    const s = stateRef.current
    if (s.animTimer) clearTimeout(s.animTimer)
    s.animTimer = null
    const sheet = sheetRef.current
    const backdrop = backdropRef.current
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
    s.animTimer = setTimeout(finish, DISMISS_ANIM_MS + 50)
  }

  function clearSheetVisuals() {
    const s = stateRef.current
    const sheet = sheetRef.current
    const backdrop = backdropRef.current
    if (sheet) { sheet.classList.remove('bottom-sheet--dragging'); sheet.style.removeProperty('--sheet-drag-y'); sheet.style.transition = '' }
    if (backdrop) { backdrop.classList.remove('bottom-sheet--dragging'); backdrop.style.removeProperty('--sheet-backdrop-opacity'); backdrop.style.transition = '' }
    s.liveDragY = 0
  }

  function detachWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
  }

  function beginSheetDrag(sheet: HTMLElement, e: PointerEvent, dragOffset = 0) {
    const s = stateRef.current
    if (s.sheetDragging) return
    s.sheetDragging = true
    s.allowNativeScroll = false
    try { sheet.setPointerCapture(e.pointerId) } catch { /**/ }
    if (dragOffset > 0) schedulePaint(dragOffset)
  }

  function suppressClickIfNeeded(didDrag: boolean) {
    const s = stateRef.current
    if (!s.clickSuppressEl || !didDrag) { s.clickSuppressEl = null; return }
    const el = s.clickSuppressEl
    const block = (ev: Event) => { ev.preventDefault(); ev.stopImmediatePropagation() }
    el.addEventListener('click', block, { capture: true, once: true })
    s.clickSuppressEl = null
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const sheet = sheetRef.current
    if (!sheet || !sheet.contains(e.target as Node)) return
    if (isTextInput(e.target)) return
    const s = stateRef.current
    if (s.animTimer) { clearTimeout(s.animTimer); s.animTimer = null }
    s.cachedHeight = sheet.offsetHeight || window.innerHeight * 0.86
    s.scrollEl = findScrollEl(e.target, sheet)
    s.touchInScrollArea = isInsideScrollArea(e.target, sheet)
    s.startScrollTop = s.scrollEl?.scrollTop ?? 0
    s.clickSuppressEl = findClickSuppressEl(e.target)
    s.startClientY = e.clientY
    s.startDragY = s.liveDragY
    s.pointerId = e.pointerId
    s.sheetDragging = false
    s.allowNativeScroll = false
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
  }

  function onPointerMove(e: PointerEvent) {
    const s = stateRef.current
    if (s.pointerId === null || e.pointerId !== s.pointerId) return
    const sheet = sheetRef.current
    if (!sheet) return
    const dy = e.clientY - s.startClientY
    if (s.sheetDragging) {
      if (e.cancelable) e.preventDefault()
      schedulePaint(Math.max(0, s.startDragY + dy))
      return
    }
    if (Math.abs(dy) < DRAG_LOCK_PX) return
    if (!s.scrollEl || !isScrollable(s.scrollEl)) {
      if (dy > 0) { beginSheetDrag(sheet, e, Math.max(0, dy - DRAG_LOCK_PX)); if (e.cancelable) e.preventDefault() }
      return
    }
    const pulled = Math.max(0, dy - DRAG_LOCK_PX)
    const st = s.scrollEl.scrollTop
    if (s.allowNativeScroll) {
      if (st <= SCROLL_TOP_EPS && dy > 0) { beginSheetDrag(sheet, e, pulled); if (e.cancelable) e.preventDefault() }
      return
    }
    if (dy < 0) { s.allowNativeScroll = true; return }
    if (dy > 0 && st > SCROLL_TOP_EPS) {
      if (s.touchInScrollArea) { s.allowNativeScroll = true; return }
      return
    }
    if (dy > 0 && st <= SCROLL_TOP_EPS) { beginSheetDrag(sheet, e, pulled); if (e.cancelable) e.preventDefault() }
  }

  function onPointerUp(e: PointerEvent) {
    const s = stateRef.current
    if (s.pointerId === null || e.pointerId !== s.pointerId) return
    detachWindowListeners()
    const sheet = sheetRef.current
    if (sheet?.hasPointerCapture(e.pointerId)) { try { sheet.releasePointerCapture(e.pointerId) } catch { /**/ } }
    const dy = e.clientY - s.startClientY
    if (s.sheetDragging) flushPaint(Math.max(0, s.startDragY + dy))
    else if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = 0 }
    const didMove = Math.abs(dy) > DRAG_LOCK_PX || s.liveDragY > DRAG_LOCK_PX
    const wasSheetDrag = s.sheetDragging
    const finalY = s.liveDragY
    s.pointerId = null; s.sheetDragging = false; s.allowNativeScroll = false; s.touchInScrollArea = false
    suppressClickIfNeeded(wasSheetDrag || (didMove && finalY > 0))
    if (!wasSheetDrag) return
    if (finalY >= dismissThreshold()) {
      animateTo(s.cachedHeight, () => { if (s.animTimer) { clearTimeout(s.animTimer); s.animTimer = null } onClose(); clearSheetVisuals() })
    } else {
      animateTo(0, () => clearSheetVisuals())
    }
  }

  function onPointerCancel(e: PointerEvent) {
    const s = stateRef.current
    if (s.pointerId === null || e.pointerId !== s.pointerId) return
    detachWindowListeners()
    if (s.rafId) { cancelAnimationFrame(s.rafId); s.rafId = 0 }
    const sheet = sheetRef.current
    if (sheet?.hasPointerCapture(e.pointerId)) { try { sheet.releasePointerCapture(e.pointerId) } catch { /**/ } }
    suppressClickIfNeeded(s.sheetDragging)
    s.pointerId = null; s.sheetDragging = false; s.allowNativeScroll = false; s.touchInScrollArea = false
    animateTo(0, () => clearSheetVisuals())
  }

  return { onPointerDown, onPointerUp, onPointerCancel }
}
