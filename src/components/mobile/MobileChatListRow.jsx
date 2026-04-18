import React from 'react'
import WA from '../../utils/waTheme'
import { getOwnerColor } from '../../utils/operators'
import { getCreatorStatusMeta } from '../../utils/creatorMeta'

function getCreatorLastTs(creator) {
  return creator?.last_active_ts
    || creator?.last_message_ts
    || (creator?.last_active ? new Date(creator.last_active).getTime() : 0)
    || (creator?.updated_at ? new Date(creator.updated_at).getTime() : 0)
    || 0
}

const LIFECYCLE_LABELS = {
  acquisition: '获取',
  activation: '激活',
  retention: '留存',
  revenue: '变现',
  terminated: '终止池',
}

function formatChatListTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const diffMs = now - d
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  }
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function MobileChatListRow({ creator, onClick, unread = 0 }) {
  const ownerColor = getOwnerColor(creator.wa_owner, WA.textMuted)
  const statusMeta = getCreatorStatusMeta(creator)
  const lifecycle = creator.lifecycle || creator._full?.lifecycle || null
  const lifecycleLabel = lifecycle?.stage_key ? LIFECYCLE_LABELS[lifecycle.stage_key] : ''
  const lastActiveTs = getCreatorLastTs(creator)
  const lastActiveLabel = lastActiveTs ? formatChatListTime(lastActiveTs) : ''

  const primaryBadge = statusMeta.label || lifecycleLabel
  const primaryBadgeColor = statusMeta.label ? statusMeta.accent : WA.teal
  const primaryBadgeBg = statusMeta.label
    ? (statusMeta.bg === 'transparent' ? WA.shellPanelMuted : statusMeta.bg)
    : WA.shellAccentSoft

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-3 active:opacity-75 transition-colors"
      style={{
        padding: '12px 16px',
        background: WA.white,
        borderBottom: `1px solid ${WA.borderLight}`,
      }}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div
          className="rounded-full flex items-center justify-center text-white font-semibold"
          style={{ background: ownerColor, width: 44, height: 44, fontSize: 16 }}
        >
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        {unread > 0 && (
          <span
            className="absolute text-white font-bold inline-flex items-center justify-center rounded-full"
            style={{
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              fontSize: 10,
              background: '#E96D5A',
              boxShadow: `0 0 0 2px ${WA.white}`,
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Row 1: name + time */}
        <div className="flex items-center gap-2">
          <span
            className="flex-1 min-w-0 truncate"
            style={{ color: WA.textDark, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}
          >
            {creator.primary_name || creator.wa_phone || 'Unknown'}
          </span>
          {lastActiveLabel && (
            <span className="shrink-0" style={{ color: WA.textMuted, fontSize: 11 }}>
              {lastActiveLabel}
            </span>
          )}
        </div>

        {/* Row 2: phone or preview */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="flex-1 min-w-0 truncate"
            style={{ color: WA.textMuted, fontSize: 12 }}
          >
            {creator.wa_phone || creator.wa_owner || '-'}
          </span>
          {creator.wa_owner && (
            <span
              className="shrink-0 rounded-full font-semibold"
              style={{
                padding: '1px 7px',
                fontSize: 10,
                background: ownerColor + '20',
                color: ownerColor,
              }}
            >
              {creator.wa_owner}
            </span>
          )}
        </div>

        {/* Row 3: status badge (at most 1) */}
        {primaryBadge && (
          <div className="mt-1">
            <span
              className="inline-flex rounded-full font-semibold"
              style={{
                padding: '2px 8px',
                fontSize: 10,
                background: primaryBadgeBg,
                color: primaryBadgeColor,
              }}
            >
              {primaryBadge}
            </span>
          </div>
        )}
      </div>
    </button>
  )
}
