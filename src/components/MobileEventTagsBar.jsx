import React from 'react'
import WA from '../utils/waTheme'
import { getCreatorSignalBadges, getCreatorTrialPhaseMeta } from '../utils/creatorMeta'

export function MobileEventTagsBar({ creator, statusMeta, visible }) {
  if (!creator?.joinbrands) return null
  const trialPhaseMeta = getCreatorTrialPhaseMeta(creator)
  const signalBadges = getCreatorSignalBadges(creator)

  return (
    <div
      className="overflow-x-auto px-4 py-2 gap-2 transition-all duration-200"
      style={{
        background: WA.white,
        borderBottom: `1px solid ${WA.borderLight}`,
        maxHeight: visible ? '60px' : '0',
        overflowX: 'auto',
        overflowY: 'hidden',
        opacity: visible ? 1 : 0,
      }}
    >
      <div className="flex gap-2">
        {statusMeta?.label && (
          <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: statusMeta.bg, color: statusMeta.accent }}>
            {statusMeta.label}
          </span>
        )}
        {trialPhaseMeta && (
          <span className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: trialPhaseMeta.bg, color: trialPhaseMeta.color }}>
            {trialPhaseMeta.label}
          </span>
        )}
        {signalBadges.map((badge) => (
          <span key={badge.key} className="text-xs px-3 py-1 rounded-full font-semibold shrink-0" style={{ background: badge.bg, color: badge.color }}>
            {badge.label}
          </span>
        ))}
      </div>
    </div>
  )
}
