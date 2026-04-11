import { getAppAuthHeaders } from './appAuth'

async function fetchJsonOrThrow(url, options = {}) {
  const headers = getAppAuthHeaders(options.headers || {})
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (typeof data?.error ***REMOVED***= 'string' && data.error.trim()) message = data.error.trim()
    } catch (_) {}
    throw new Error(message)
  }
  return res.json()
}

async function fetchOkOrThrow(url, options = {}) {
  const headers = getAppAuthHeaders(options.headers || {})
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (typeof data?.error ***REMOVED***= 'string' && data.error.trim()) message = data.error.trim()
    } catch (_) {}
    throw new Error(message)
  }
  return res
}

export { fetchJsonOrThrow, fetchOkOrThrow }
