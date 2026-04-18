import React, { useEffect, useState } from 'react'
import HERO_IMAGE from '../assets/k2-login.webp'
import {
  fetchAppAuth,
  getAppAuthToken,
  getAppAuthUsername,
  logoutAppAuth,
  setAppAuthScope,
  setAppAuthToken,
  setAppAuthUsername,
  setAppAuthRole,
  stripLegacyTokenFromUrl,
} from '../utils/appAuth'

async function parseJsonSafe(res) {
  try {
    return await res.json()
  } catch (_) {
    return null
  }
}

async function loginWithPassword({ username, password }) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await parseJsonSafe(res)
  if (!res.ok) {
    const message = typeof data?.error === 'string' && data.error.trim()
      ? data.error.trim()
      : `HTTP ${res.status}`
    throw new Error(message)
  }
  return data || {}
}

async function checkSession() {
  const res = await fetchAppAuth('/api/auth/session')
  if (res.status === 401) {
    return { ok: false, unauthorized: true }
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (typeof data?.error === 'string' && data.error.trim()) message = data.error.trim()
    } catch (_) {}
    throw new Error(message)
  }
  const data = await res.json()
  return { ok: true, session: data }
}

function FieldShell({ children }) {
  return (
    <label className="block w-full">
      <div
        className="border-b pb-2 transition-colors"
        style={{ borderColor: 'rgba(23, 37, 84, 0.18)' }}
      >
        {children}
      </div>
    </label>
  )
}

export function AppAuthGate({ children }) {
  const [status, setStatus] = useState('checking')
  const [username, setUsername] = useState(getAppAuthUsername() || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      const strippedLegacyToken = stripLegacyTokenFromUrl()

      try {
        const result = await checkSession()
        if (cancelled) return
        if (result.ok) {
          if (result.session?.username) setAppAuthUsername(result.session.username)
          setAppAuthScope(result.session || {})
          setAppAuthRole(result.session?.role, result.session?.user_id)
          setStatus('ready')
          setError('')
          return
        }
        setStatus('needs-auth')
        if (result.unauthorized && strippedLegacyToken) {
          await logoutAppAuth()
          if (cancelled) return
          setError('已移除 URL 里的旧 token,请重新登录。')
        } else if (result.unauthorized && !getAppAuthToken()) {
          setError('')
        } else if (result.unauthorized) {
          await logoutAppAuth()
          if (cancelled) return
          setError('会话已失效或被管理员注销,请重新登录。')
        }
      } catch (err) {
        if (cancelled) return
        setStatus('needs-auth')
        setError(err.message || '认证检查失败')
      }
    }

    bootstrap()
    return () => { cancelled = true }
  }, [])

  async function handlePasswordSubmit(event) {
    event.preventDefault()
    const normalizedUsername = String(username || '').trim()
    if (!normalizedUsername || !password) {
      setError('请输入用户名和密码')
      return
    }

    setStatus('checking')
    setError('')
    try {
      const result = await loginWithPassword({ username: normalizedUsername, password })
      setAppAuthToken(result.token || '')
      setAppAuthUsername(result.username || normalizedUsername)
      setAppAuthRole(result.role, result.user_id)
      setAppAuthScope({
        owner: result.owner,
        owner_locked: !!result.owner_locked,
      })
      setPassword('')
      setStatus('ready')
    } catch (err) {
      await logoutAppAuth()
      setStatus('needs-auth')
      setError(err.message || '登录失败')
    }
  }

  if (status === 'ready') return children

  return (
    <div
      className="min-h-screen px-4 py-6 sm:px-8 sm:py-10 lg:px-12 lg:py-12 flex items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #d7d1ca 0%, #e8e1d8 42%, #f2ece3 100%)',
      }}
    >
      <div
        className="w-full max-w-[1120px] overflow-hidden rounded-[32px] border shadow-[0_28px_90px_rgba(41,33,23,0.14)] lg:grid lg:grid-cols-[0.88fr_1fr]"
        style={{
          background: 'rgba(255, 251, 246, 0.88)',
          borderColor: 'rgba(255, 255, 255, 0.65)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <div className="relative min-h-[240px] lg:min-h-[720px] overflow-hidden">
          <img
            src={HERO_IMAGE}
            alt="K2 mountain"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(160deg, rgba(8,18,44,0.22) 0%, rgba(7,18,49,0.42) 44%, rgba(7,18,49,0.68) 100%)',
            }}
          />
          <div className="relative z-10 flex h-full flex-col justify-between p-8 sm:p-10 lg:px-12 lg:py-12 xl:px-14 xl:py-14">
            <div
              className="inline-flex items-center self-start rounded-full px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.28em]"
              style={{
                background: 'rgba(255,255,255,0.16)',
                color: 'rgba(255,255,255,0.82)',
                border: '1px solid rgba(255,255,255,0.22)',
              }}
            >
              K2 Access Node
            </div>

            <div className="max-w-[340px] pb-4 lg:pb-10">
              <div
                className="text-[14px] uppercase tracking-[0.36em] font-medium"
                style={{ color: 'rgba(255,255,255,0.74)' }}
              >
                Welcome
              </div>
              <div
                className="mt-4 text-[34px] sm:text-[42px] lg:text-[48px] font-semibold tracking-[-0.04em] leading-none"
                style={{ color: '#f8fafc' }}
              >
                WA CRM
              </div>
            </div>
          </div>
        </div>

        <div className="flex min-h-[520px] items-center justify-center bg-[rgba(255,253,249,0.96)] px-6 py-8 sm:px-10 lg:min-h-[720px] lg:px-14">
          <div className="mx-auto flex w-full max-w-[328px] flex-col items-center text-center">
            <div
              className="text-[12px] uppercase tracking-[0.34em] font-medium"
              style={{ color: 'rgba(31,29,26,0.46)' }}
            >
              Protected Access
            </div>
            <h1
              className="mt-3 text-[42px] sm:text-[56px] font-semibold tracking-[-0.06em] leading-none"
              style={{ color: '#161616' }}
            >
              Login
            </h1>

            {status === 'checking' ? (
              <div className="mt-12 text-[15px]" style={{ color: 'rgba(29, 41, 57, 0.64)' }}>
                正在验证访问权限...
              </div>
            ) : (
              <form className="mt-14 flex w-full flex-col items-center gap-7" onSubmit={handlePasswordSubmit}>
                <FieldShell>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="输入用户名"
                    className="w-full bg-transparent text-left text-[17px] leading-8 outline-none"
                    style={{ color: '#1f2937' }}
                    autoComplete="username"
                  />
                </FieldShell>

                <FieldShell>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入密码"
                    className="w-full bg-transparent text-left text-[17px] leading-8 outline-none"
                    style={{ color: '#1f2937' }}
                    autoComplete="current-password"
                  />
                </FieldShell>

                {error ? (
                  <div
                    className="rounded-[20px] px-4 py-3 text-sm"
                    style={{ background: 'rgba(127, 29, 29, 0.08)', color: '#b91c1c' }}
                  >
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  className="mt-4 w-[82%] min-w-[220px] rounded-[18px] px-4 py-4 text-[18px] font-medium text-white transition-transform active:scale-[0.99]"
                  style={{
                    background: 'linear-gradient(135deg, #10214f 0%, #1f3a8a 100%)',
                    boxShadow: '0 20px 34px rgba(16,33,79,0.14)',
                  }}
                >
                  登录进入系统
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AppAuthGate
