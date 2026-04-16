import { getAppAuthToken } from './appAuth'

const WA_ADMIN_TOKEN_KEY = 'wa_admin_token'

export function getWaAdminToken() {
  try {
    return localStorage.getItem(WA_ADMIN_TOKEN_KEY) || getAppAuthToken() || ''
  } catch (_) {
    return getAppAuthToken() || ''
  }
}

export function getWaAdminHeaders(extraHeaders = {}) {
  const token = getWaAdminToken()
  return token
    ? { ...extraHeaders, Authorization: `Bearer ${token}` }
    : { ...extraHeaders }
}

export async function fetchWaAdmin(url, options = {}) {
  const headers = getWaAdminHeaders(options.headers || {})
  return fetch(url, { ...options, headers })
}
