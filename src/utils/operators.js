export const OWNER_COLORS = {
  Beau: '#3b82f6',
  Yiyun: '#8b5cf6',
  Jiawen: '#ec4899',
  WangYouKe: '#14b8a6',
}

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
  if (ai !***REMOVED*** -1 || bi !***REMOVED*** -1) {
    if (ai ***REMOVED***= -1) return 1
    if (bi ***REMOVED***= -1) return -1
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
