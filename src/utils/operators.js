import { useEffect, useMemo, useState } from 'react'
import { fetchJsonOrThrow } from './api'

export const OWNER_COLORS = {
  Beau: '#3b82f6',
  Yiyun: '#8b5cf6',
  Jiawen: '#ec4899',
  WangYouKe: '#14b8a6',
}

// Fallback ordering when the dynamic /api/operator-roster is unavailable.
// The list below is intentionally duplicated from server/config/operatorRoster.js
// so the UI still renders something usable before the roster fetch resolves.
export const OWNER_ORDER = ['Beau', 'Yiyun', 'Jiawen', 'WangYouKe']

export function getOwnerColor(owner, fallback = '#94a3b8') {
  if (OWNER_COLORS[owner]) return OWNER_COLORS[owner]
  if (!owner) return fallback
  let hash = 0
  for (let i = 0; i < owner.length; i += 1) hash = owner.charCodeAt(i) + ((hash << 5) - hash)
  const palette = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ef4444', '#14b8a6']
  return palette[Math.abs(hash) % palette.length] || fallback
}

export function sortOwners(a, b) {
  const ai = OWNER_ORDER.indexOf(a)
  const bi = OWNER_ORDER.indexOf(b)
  if (ai !== -1 || bi !== -1) {
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  }
  return String(a).localeCompare(String(b), 'zh-CN')
}

export function buildOwnerOptions(values = [], { includeAll = false } = {}) {
  const names = new Set(OWNER_ORDER)
  for (const value of values) {
    if (value) names.add(value)
  }
  const ordered = [...names].sort(sortOwners)
  return includeAll ? [''].concat(ordered) : ordered
}

let _rosterPromise = null

function loadRosterCached() {
  if (!_rosterPromise) {
    _rosterPromise = fetchJsonOrThrow('/api/operator-roster')
      .then((res) => (Array.isArray(res?.data) ? res.data : []))
      .catch((err) => {
        _rosterPromise = null
        throw err
      })
  }
  return _rosterPromise
}

export const OPERATOR_ROSTER_REFRESH_EVENT = 'operator-roster-refresh'

/**
 * 主动清空 roster 模块级缓存并广播 `operator-roster-refresh` 事件,
 * 让所有已挂载的 useOperatorRoster 使用方重新拉取最新名单。
 * 在 UsersPanel 增/改 operator_name 成功后调用。
 */
export function clearRosterCache() {
  _rosterPromise = null
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(OPERATOR_ROSTER_REFRESH_EVENT))
    } catch (_) {
      // noop: CustomEvent polyfill missing in stale browsers; cache is still cleared
    }
  }
}

/**
 * React hook that fetches `/api/operator-roster` once per session and returns
 * a dynamic owner list. Falls back to `OWNER_ORDER` until the fetch resolves
 * (or if it fails), so callers can render a selector immediately.
 *
 * 额外监听 `operator-roster-refresh` 事件,收到后重新拉取(用于 admin
 * 在 UsersPanel 新增 owner 后让其它页面的下拉实时跟上)。
 */
export function useOperatorRoster() {
  const [roster, setRoster] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let mounted = true
    loadRosterCached()
      .then((data) => {
        if (!mounted) return
        setRoster(data)
        setLoading(false)
      })
      .catch((err) => {
        if (!mounted) return
        setError(err)
        setLoading(false)
      })
    return () => { mounted = false }
  }, [tick])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handler = () => setTick((n) => n + 1)
    window.addEventListener(OPERATOR_ROSTER_REFRESH_EVENT, handler)
    return () => window.removeEventListener(OPERATOR_ROSTER_REFRESH_EVENT, handler)
  }, [])

  const owners = useMemo(() => {
    const names = (roster || []).map((item) => item?.operator).filter(Boolean)
    if (names.length === 0) return [...OWNER_ORDER]
    return [...names].sort(sortOwners)
  }, [roster])

  return { roster: roster || [], owners, loading, error }
}
