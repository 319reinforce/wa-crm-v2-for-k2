const TOKEN_KEYS = ['api_auth_token', 'crm_admin_token', 'wa_admin_token', 'ai_proxy_token']
const PRIMARY_TOKEN_KEY = TOKEN_KEYS[0]
const USERNAME_KEY = 'app_auth_username'
const SCOPE_OWNER_KEY = 'app_auth_scope_owner'
const SCOPE_SESSION_ID_KEY = 'app_auth_scope_session_id'
const SCOPE_LOCKED_KEY = 'app_auth_scope_locked'
const ROLE_KEY = 'app_auth_role'
const USER_ID_KEY = 'app_auth_user_id'

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

export function setAppAuthToken(token) {
  const normalized = String(token || '').trim()
  try {
    if (!normalized) {
      TOKEN_KEYS.forEach((key) => localStorage.removeItem(key))
      return ''
    }
    localStorage.setItem(PRIMARY_TOKEN_KEY, normalized)
    return normalized
  } catch (_) {
    return normalized
  }
}

export function clearAppAuthToken() {
  return setAppAuthToken('')
}

export function getAppAuthUsername() {
  try {
    return localStorage.getItem(USERNAME_KEY) || ''
  } catch (_) {
    return ''
  }
}

export function setAppAuthUsername(username) {
  const normalized = String(username || '').trim()
  try {
    if (!normalized) {
      localStorage.removeItem(USERNAME_KEY)
      return ''
    }
    localStorage.setItem(USERNAME_KEY, normalized)
    return normalized
  } catch (_) {
    return normalized
  }
}

export function getAppAuthRole() {
  try {
    return localStorage.getItem(ROLE_KEY) || ''
  } catch (_) {
    return ''
  }
}

export function getAppAuthUserId() {
  try {
    const raw = localStorage.getItem(USER_ID_KEY)
    return raw ? Number(raw) : null
  } catch (_) {
    return null
  }
}

export function setAppAuthRole(role, userId) {
  try {
    if (role) localStorage.setItem(ROLE_KEY, String(role))
    else localStorage.removeItem(ROLE_KEY)
    if (userId) localStorage.setItem(USER_ID_KEY, String(userId))
    else localStorage.removeItem(USER_ID_KEY)
  } catch (_) {}
}

export function clearAppAuthRole() {
  try {
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(USER_ID_KEY)
  } catch (_) {}
}

export function isAppAuthAdmin() {
  return getAppAuthRole() === 'admin'
}

export function clearAppAuthSession() {
  clearAppAuthToken()
  setAppAuthUsername('')
  clearAppAuthScope()
  clearAppAuthRole()
}

export function getAppAuthScopeOwner() {
  try {
    return localStorage.getItem(SCOPE_OWNER_KEY) || ''
  } catch (_) {
    return ''
  }
}

export function getAppAuthScopeSessionId() {
  try {
    return localStorage.getItem(SCOPE_SESSION_ID_KEY) || ''
  } catch (_) {
    return ''
  }
}

export function isAppAuthOwnerLocked() {
  try {
    return localStorage.getItem(SCOPE_LOCKED_KEY) === '1'
  } catch (_) {
    return false
  }
}

export function setAppAuthScope(scope = {}) {
  const owner = String(scope?.owner || '').trim()
  const sessionId = String(scope?.session_id || '').trim()
  const locked = !!scope?.owner_locked && !!owner
  try {
    if (owner) localStorage.setItem(SCOPE_OWNER_KEY, owner)
    else localStorage.removeItem(SCOPE_OWNER_KEY)

    if (sessionId) localStorage.setItem(SCOPE_SESSION_ID_KEY, sessionId)
    else localStorage.removeItem(SCOPE_SESSION_ID_KEY)

    if (locked) localStorage.setItem(SCOPE_LOCKED_KEY, '1')
    else localStorage.removeItem(SCOPE_LOCKED_KEY)
  } catch (_) {}
  return { owner, sessionId, locked }
}

export function clearAppAuthScope() {
  try {
    localStorage.removeItem(SCOPE_OWNER_KEY)
    localStorage.removeItem(SCOPE_SESSION_ID_KEY)
    localStorage.removeItem(SCOPE_LOCKED_KEY)
  } catch (_) {}
}

export async function logoutAppAuth() {
  try {
    await fetchAppAuth('/api/auth/logout', {
      method: 'POST',
    })
  } catch (_) {}
  clearAppAuthSession()
}

export function getAppAuthHeaders(extraHeaders = {}) {
  const token = getAppAuthToken()
  return token
    ? { ...extraHeaders, Authorization: `Bearer ${token}` }
    : { ...extraHeaders }
}

export function stripLegacyTokenFromUrl() {
  if (typeof window === 'undefined') return false
  try {
    const current = new URL(window.location.href)
    if (!current.searchParams.has('token')) return false
    current.searchParams.delete('token')
    window.history.replaceState({}, document.title, `${current.pathname}${current.search}${current.hash}`)
    return true
  } catch (_) {
    return false
  }
}

export async function fetchAppAuth(url, options = {}) {
  const headers = getAppAuthHeaders(options.headers || {})
  return fetch(url, { ...options, headers, credentials: 'same-origin' })
}
