import React from 'react'
import { getCreatorStatusMeta } from '../utils/creatorMeta'
import { getOwnerColor } from '../utils/operators'
import WA from '../utils/waTheme'

export default function KanbanView({ columns = [], creators = [], onCreatorClick }) {
  return (
    <div className="flex gap-3 p-3 overflow-x-auto h-full" role="list" aria-label="达人看板">
      {columns.map((column) => {
        const colCreators = creators.filter((creator) => column.filter(creator))
        return (
          <section
            key={column.key}
            className="flex flex-col w-56 shrink-0 rounded-2xl overflow-hidden"
            style={{ background: '#f5f6f7' }}
            aria-label={`${column.label} ${colCreators.length} 位`}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ background: column.color + '18' }}>
              <span className="text-sm font-bold" style={{ color: column.color }}>{column.label}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-bold" style={{ background: column.color + '25', color: column.color }}>
                {colCreators.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {colCreators.map((creator) => (
                <KanbanCard
                  key={creator.id}
                  creator={creator}
                  color={column.color}
                  onClick={() => onCreatorClick?.(creator)}
                />
              ))}
              {colCreators.length === 0 && (
                <div className="text-center py-8 text-xs" style={{ color: WA.textMuted }}>无</div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function KanbanCard({ creator, color, onClick }) {
  const ownerColor = getOwnerColor(creator.wa_owner)
  const statusMeta = getCreatorStatusMeta(creator)
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl p-4 cursor-pointer hover:shadow-lg transition-all"
      style={{
        borderLeft: `4px solid ${statusMeta.accent === 'transparent' ? color : statusMeta.accent}`,
        background: statusMeta.bg === 'transparent' ? WA.white : `linear-gradient(180deg, ${statusMeta.bg} 0%, ${WA.white} 72%)`,
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ background: ownerColor }}>
          {(creator.primary_name || '?')[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</div>
          <div className="text-xs" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'}</div>
          {statusMeta.label && (
            <div className="mt-1">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: statusMeta.bg, color: statusMeta.accent }}>
                {statusMeta.label}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: '#10b981' }}>
          {creator.keeper_gmv > 0 ? '$' + Number(creator.keeper_gmv).toLocaleString() : '-'}
        </span>
        <span className="text-xs" style={{ color: WA.textMuted }}>{creator.msg_count || 0} msg</span>
      </div>
    </button>
  )
}
