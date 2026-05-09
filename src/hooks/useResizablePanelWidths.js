import { useEffect, useState } from 'react'

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export default function useResizablePanelWidths({
  storageKey = 'wa_panel_widths',
  defaults = { list: 320 },
  limits = { list: { min: 260, max: 500 } },
} = {}) {
  const [panelWidths, setPanelWidths] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        return {
          list: clamp(Number(parsed?.list) || defaults.list, limits.list.min, limits.list.max),
        }
      }
    } catch (_) {}
    return defaults
  })
  const [dragging, setDragging] = useState(null)

  const savePanelWidths = (widths) => {
    try { localStorage.setItem(storageKey, JSON.stringify(widths)) } catch (_) {}
    setPanelWidths(widths)
  }

  const startDrag = (handle) => (event) => {
    event.preventDefault()
    setDragging(handle)
  }

  useEffect(() => {
    if (!dragging) return undefined
    const onMove = (event) => {
      const clientX = event.touches ? event.touches[0].clientX : event.clientX
      setPanelWidths((prev) => {
        const next = { ...prev }
        if (dragging === 'list-detail') {
          next.list = clamp(clientX, limits.list.min, limits.list.max)
        }
        try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch (_) {}
        return next
      })
    }
    const onUp = () => setDragging(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [dragging, limits.list.max, limits.list.min, storageKey])

  return {
    dragging,
    panelWidths,
    savePanelWidths,
    setPanelWidths: savePanelWidths,
    startDrag,
  }
}
