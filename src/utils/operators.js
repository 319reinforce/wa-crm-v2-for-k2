import { useEffect, useMemo, useState } from 'react'
import { fetchJsonOrThrow } from './api'

export const OWNER_COLORS = {
  Beau: '#3b82f6',
  Yiyun: '#8b5cf6',
  WangYouKe: '#14b8a6',
  Jaylyn: '#f97316',
  Jiawei: '#0ea5e9',
}

const HIDDEN_OWNER_KEYS = new Set(['jiawen', 'sybil'])

export function isHiddenOwner(owner) {
  const key = String(owner || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return HIDDEN_OWNER_KEYS.has(key)
}

// Dynamic owner lists come from /api/operator-roster. Keep this empty so local
// fixed owners do not appear unless they exist in users/creators/wa_sessions.
export const OWNER_ORDER = []

// Business-facing display priority for owner chips and selectors.
const OWNER_SORT_ORDER = ['Yiyun', 'Beau', 'WangYouKe', 'Jaylyn', 'Jiawei']
const OWNER_ORDER_ALIASES = {
  yiyun: 'Yiyun',
  yanyiyun: 'Yiyun',
  alice: 'Yiyun',
  beau: 'Beau',
  yifan: 'Beau',
  youke: 'WangYouKe',
  wangyouke: 'WangYouKe',
  bella: 'WangYouKe',
  youkebella: 'WangYouKe',
  jaylyn: 'Jaylyn',
  jiawei: 'Jiawei',
}

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
  const ar = ownerSortRank(a)
  const br = ownerSortRank(b)
  if (ar !== br) return ar - br
  return String(a).localeCompare(String(b), 'zh-CN')
}

function ownerSortRank(owner) {
  const key = String(owner || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const canonical = OWNER_ORDER_ALIASES[key] || owner
  const rank = OWNER_SORT_ORDER.indexOf(canonical)
  return rank === -1 ? Number.POSITIVE_INFINITY : rank
}

export function buildOwnerOptions(values = [], { includeAll = false } = {}) {
  const names = new Set(OWNER_ORDER)
  for (const value of values) {
    if (value && !isHiddenOwner(value)) names.add(value)
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
 * a dynamic owner list. Returns an empty list until the fetch resolves (or if
 * it fails), so callers only show owners that exist in runtime data.
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
    const names = (roster || []).map((item) => item?.operator).filter((name) => name && !isHiddenOwner(name))
    if (names.length === 0) return [...OWNER_ORDER]
    return [...names].sort(sortOwners)
  }, [roster])

  return { roster: roster || [], owners, loading, error }
}
