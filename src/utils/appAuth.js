const TOKEN_KEYS = ['api_auth_token', 'crm_admin_token', 'wa_admin_token', 'ai_proxy_token']

export function getAppAuthToken() {
  try {
    for (const key of TOKEN_KEYS) {
      const value = localStorage.getItem(key)
      if (value) return value
    }
    return ''
  } catch (_) {
    return ''
  }
}

export function getAppAuthHeaders(extraHeaders = {}) {
  const token = getAppAuthToken()
  return token
    ? { ...extraHeaders, Authorization: `Bearer ${token}` }
    : { ...extraHeaders }
}

export function buildAppAuthUrl(url) {
  const token = getAppAuthToken()
  if (!token || typeof window ***REMOVED***= 'undefined') return url

  try {
    const resolved = new URL(url, window.location.origin)
    resolved.searchParams.set('token', token)
    return resolved.origin ***REMOVED***= window.location.origin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : resolved.toString()
  } catch (_) {
    return url
  }
}

export async function fetchAppAuth(url, options = {}) {
  const headers = getAppAuthHeaders(options.headers || {})
  return fetch(url, { ...options, headers })
}
