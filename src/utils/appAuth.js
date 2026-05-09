const TOKEN_KEYS = ['api_auth_token', 'crm_admin_token', 'wa_admin_token', 'ai_proxy_token']
const PRIMARY_TOKEN_KEY = TOKEN_KEYS[0]
const USERNAME_KEY = 'app_auth_username'
const SCOPE_OWNER_KEY = 'app_auth_scope_owner'
const SCOPE_SESSION_ID_KEY = 'app_auth_scope_session_id'
const SCOPE_LOCKED_KEY = 'app_auth_scope_locked'
const ROLE_KEY = 'app_auth_role'
const USER_ID_KEY = 'app_auth_user_id'
const AUTH_CHANGE_EVENT = 'app-auth-change'
const APP_AUTH_STORAGE_KEYS = [
  ...TOKEN_KEYS,
  USERNAME_KEY,
  SCOPE_OWNER_KEY,
  SCOPE_SESSION_ID_KEY,
  SCOPE_LOCKED_KEY,
  ROLE_KEY,
  USER_ID_KEY,
]

function canUseWindow() {
  return typeof window !== 'undefined'
}

function notifyAppAuthChanged() {
  if (!canUseWindow()) return
  try {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: readAppAuthSnapshot() }))
  } catch (_) {}
}

export function readAppAuthSnapshot() {
  return {
    token: getAppAuthToken(),
    username: getAppAuthUsername(),
    role: getAppAuthRole(),
    userId: getAppAuthUserId(),
    scopeOwner: getAppAuthScopeOwner(),
    scopeSessionId: getAppAuthScopeSessionId(),
    ownerLocked: isAppAuthOwnerLocked(),
  }
}

export function subscribeAppAuthChanges(callback) {
  if (!canUseWindow() || typeof callback !== 'function') return () => {}
  const handler = () => callback(readAppAuthSnapshot())
  const onStorage = (event) => {
    if (!event?.key || APP_AUTH_STORAGE_KEYS.includes(event.key)) handler()
  }
  window.addEventListener(AUTH_CHANGE_EVENT, handler)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, handler)
    window.removeEventListener('storage', onStorage)
  }
}

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
      notifyAppAuthChanged()
      return ''
    }
    localStorage.setItem(PRIMARY_TOKEN_KEY, normalized)
    notifyAppAuthChanged()
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
      notifyAppAuthChanged()
      return ''
    }
    localStorage.setItem(USERNAME_KEY, normalized)
    notifyAppAuthChanged()
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
    notifyAppAuthChanged()
  } catch (_) {}
}

export function clearAppAuthRole() {
  try {
    localStorage.removeItem(ROLE_KEY)
    localStorage.removeItem(USER_ID_KEY)
    notifyAppAuthChanged()
  } catch (_) {}
}

export function isAppAuthAdmin() {
  return getAppAuthRole() === 'admin'
}

export function isAppAuthViewer() {
  return getAppAuthRole() === 'viewer'
}

// 判断当前用户对某 owner 的 creator 是否可以写(发消息、触发 AI 等)
// - admin:任意都行
// - operator:被后端锁在 getAppAuthScopeOwner(),同 owner 才行
// - viewer:虽然能跨 owner 读,但写必须等于自己的 operator_name
// 调用点若拿不到 targetOwner(如没选中 creator),传 null 视作"写自己的"
export function canAppAuthWriteToOwner(targetOwner = null) {
  const role = getAppAuthRole()
  if (role === 'admin') return true
  const myOwner = String(getAppAuthScopeOwner() || '').trim()
  if (!myOwner) return role === 'admin'
  if (!targetOwner) return true
  return String(targetOwner).trim() === myOwner
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
    notifyAppAuthChanged()
  } catch (_) {}
  return { owner, sessionId, locked }
}

export function clearAppAuthScope() {
  try {
    localStorage.removeItem(SCOPE_OWNER_KEY)
    localStorage.removeItem(SCOPE_SESSION_ID_KEY)
    localStorage.removeItem(SCOPE_LOCKED_KEY)
    notifyAppAuthChanged()
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
  const requestId = getOrCreateRequestId(extraHeaders)
  const headers = requestId ? { ...extraHeaders, 'X-Request-Id': requestId } : { ...extraHeaders }
  return token
    ? { ...headers, Authorization: `Bearer ${token}` }
    : headers
}

function getOrCreateRequestId(headers = {}) {
  const existing = headers['X-Request-Id'] || headers['x-request-id']
  if (existing) return existing
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch (_) {}
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
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
