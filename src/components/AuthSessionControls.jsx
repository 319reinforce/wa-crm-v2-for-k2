import React from 'react'
import WA from '../utils/waTheme'
import {
  getAppAuthToken,
  getAppAuthScopeOwner,
  getAppAuthScopeSessionId,
  getAppAuthUsername,
  isAppAuthOwnerLocked,
  logoutAppAuth,
  setAppAuthToken,
  setAppAuthUsername,
} from '../utils/appAuth'

function maskToken(token) {
  const normalized = String(token || '').trim()
  if (!normalized) return '未设置'
  if (normalized.length <= 10) return normalized
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`
}

export default function AuthSessionControls({ compact = false }) {
  const username = getAppAuthUsername() || 'authorized'
  const token = getAppAuthToken()
  const lockedOwner = getAppAuthScopeOwner()
  const lockedSessionId = getAppAuthScopeSessionId()
  const ownerLocked = isAppAuthOwnerLocked() && !!lockedOwner

  function reloadToGate() {
    if (typeof window !== 'undefined') window.location.reload()
  }

  function handleSwitchToken() {
    if (typeof window === 'undefined') return
    const next = window.prompt('输入新的访问 token', token || '')
    if (next === null) return
    const normalized = String(next || '').trim()
    if (!normalized) {
      window.alert('token 不能为空')
      return
    }
    setAppAuthToken(normalized)
    setAppAuthUsername('token-user')
    reloadToGate()
  }

  async function handleSwitchAccount() {
    await logoutAppAuth()
    reloadToGate()
  }

  async function handleLogout() {
    await logoutAppAuth()
    reloadToGate()
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        <div
          className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
          style={{ background: WA.shellPanelMuted, color: WA.textDark }}
        >
          {username}
        </div>
        {ownerLocked && (
          <div
            className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
            style={{ background: 'rgba(15,118,110,0.12)', color: WA.teal }}
            title={lockedSessionId || lockedOwner}
          >
            {lockedOwner}
          </div>
        )}
        <button
          onClick={handleSwitchToken}
          className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
          style={{ background: WA.shellPanelMuted, color: WA.textMuted }}
        >
          Token
        </button>
        <button
          onClick={handleLogout}
          className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
          style={{ background: 'rgba(198,95,73,0.12)', color: '#c65f49' }}
        >
          退出
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <div
        className="hidden xl:flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium"
        style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
      >
        <span style={{ color: WA.textDark }}>{username}</span>
        <span>{maskToken(token)}</span>
      </div>
      {ownerLocked && (
        <div
          className="hidden lg:flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium"
          style={{ background: 'rgba(15,118,110,0.08)', color: WA.textMuted, border: '1px solid rgba(15,118,110,0.15)' }}
        >
          <span style={{ color: WA.teal }}>{lockedOwner}</span>
          <span>{lockedSessionId || 'locked session'}</span>
        </div>
      )}
      <button
        onClick={handleSwitchAccount}
        className="px-3.5 py-2 rounded-full text-sm font-medium transition-all"
        style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
      >
        切换账号
      </button>
      <button
        onClick={handleSwitchToken}
        className="px-3.5 py-2 rounded-full text-sm font-medium transition-all"
        style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
      >
        切换 Token
      </button>
      <button
        onClick={handleLogout}
        className="px-3.5 py-2 rounded-full text-sm font-medium transition-all"
        style={{ background: 'rgba(198,95,73,0.12)', color: '#c65f49', border: '1px solid rgba(198,95,73,0.18)' }}
      >
        退出登录
      </button>
    </div>
  )
}
