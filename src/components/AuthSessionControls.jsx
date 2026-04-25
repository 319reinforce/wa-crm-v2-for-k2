import React from 'react'
import WA from '../utils/waTheme'
import {
  getAppAuthScopeOwner,
  getAppAuthScopeSessionId,
  getAppAuthUsername,
  isAppAuthOwnerLocked,
  logoutAppAuth,
} from '../utils/appAuth'
import { buildV1DashboardUrl } from '../utils/crossApp'

export default function AuthSessionControls({ compact = false }) {
  const username = getAppAuthUsername() || 'authorized'
  const lockedOwner = getAppAuthScopeOwner()
  const lockedSessionId = getAppAuthScopeSessionId()
  const ownerLocked = isAppAuthOwnerLocked() && !!lockedOwner
  const v1DashboardUrl = buildV1DashboardUrl({ tab: 'wa' })

  function reloadToGate() {
    if (typeof window !== 'undefined') window.location.reload()
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
        <a
          href={v1DashboardUrl}
          target="_blank"
          rel="noreferrer"
          className="px-2.5 py-1.5 rounded-full text-[11px] font-semibold"
          style={{ background: WA.shellPanelMuted, color: WA.textMuted }}
        >
          V1
        </a>
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
        <a
          href={v1DashboardUrl}
          target="_blank"
          rel="noreferrer"
          className="font-semibold"
          style={{ color: WA.textDark, textDecoration: 'none' }}
        >
          V1 中台
        </a>
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
        onClick={handleLogout}
        className="px-3.5 py-2 rounded-full text-sm font-medium transition-all"
        style={{ background: 'rgba(198,95,73,0.12)', color: '#c65f49', border: '1px solid rgba(198,95,73,0.18)' }}
      >
        退出登录
      </button>
    </div>
  )
}
