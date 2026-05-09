const API_BASE = '/api'

export function buildCreatorDetailUrl(creatorId, { includePhone = true } = {}) {
  const id = encodeURIComponent(String(creatorId || ''))
  const params = new URLSearchParams()
  if (includePhone) params.set('fields', 'wa_phone')
  const query = params.toString()
  return `${API_BASE}/creators/${id}${query ? `?${query}` : ''}`
}
