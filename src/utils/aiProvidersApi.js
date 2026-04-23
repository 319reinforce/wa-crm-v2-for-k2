/**
 * aiProvidersApi — fetch wrapper for AI provider admin endpoints
 */
import { getAppAuthHeaders } from './appAuth'

const API_BASE = '/api'

async function fetchAdmin(url, options = {}) {
  const headers = getAppAuthHeaders(options.headers || {})
  const res = await fetch(url, { ...options, headers, credentials: 'include' })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (typeof data?.error === 'string' && data.error.trim()) message = data.error.trim()
      else if (typeof data?.message === 'string' && data.message.trim()) message = data.message.trim()
    } catch (_) {}
    throw { status: res.status, body: message }
  }
  return res.json()
}

export const aiProvidersApi = {
  list: async (purpose) => {
    const qs = purpose ? `?purpose=${encodeURIComponent(purpose)}` : ''
    return fetchAdmin(`${API_BASE}/admin/ai-providers${qs}`)
  },

  detail: async (id) => {
    return fetchAdmin(`${API_BASE}/admin/ai-providers/${id}`)
  },

  create: async (payload) => {
    return fetchAdmin(`${API_BASE}/admin/ai-providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  update: async (id, payload) => {
    return fetchAdmin(`${API_BASE}/admin/ai-providers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  activate: async (id) => {
    return fetchAdmin(`${API_BASE}/admin/ai-providers/${id}/activate`, {
      method: 'POST',
    })
  },

  remove: async (id) => {
    return fetchAdmin(`${API_BASE}/admin/ai-providers/${id}`, {
      method: 'DELETE',
    })
  },

  usage: async (purpose, range = 7, groupBy = 'day') => {
    const qs = new URLSearchParams({ purpose: purpose || '', range: String(range), groupBy })
    return fetchAdmin(`${API_BASE}/admin/ai-usage?${qs}`)
  },

  recent: async (limit = 20, purpose) => {
    const qs = new URLSearchParams({ limit: String(limit), purpose: purpose || '' })
    return fetchAdmin(`${API_BASE}/admin/ai-usage/recent?${qs}`)
  },
}
