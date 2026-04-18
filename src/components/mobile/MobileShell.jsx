import React, { useState } from 'react'
import WA from '../../utils/waTheme'
import MobileBottomNav from './MobileBottomNav'
import MobileScreenHeader from './MobileScreenHeader'
import MobileBottomSheet from './MobileBottomSheet'
import { EventPanel } from '../EventPanel'
import { SFTDashboard } from '../SFTDashboard'
import { LifecycleConfigPanel } from '../LifecycleConfigPanel'
import { StrategyConfigPanel } from '../StrategyConfigPanel'
import { AccountsPanel } from '../AccountsPanel'
import MobileAuthMenu from './MobileAuthMenu'

const TABS = [
  { key: 'creators', label: '消息' },
  { key: 'events', label: '事件' },
  { key: 'strategy', label: '策略' },
  { key: 'sft', label: 'SFT' },
  { key: 'accounts', label: '账号', adminOnly: true },
]

export default function MobileShell({
  // tab state
  activeTab,
  setActiveTab,
  ownerLocked,
  // creator list data
  creators,
  filteredCreators,
  loading,
  unreadCounts,
  search,
  setSearch,
  filterOwner,
  setFilterOwner,
  ownerOptions,
  filterLifecycle,
  setFilterLifecycle,
  filterBeta,
  setFilterBeta,
  filterPriority,
  setFilterPriority,
  filterAgency,
  setFilterAgency,
  filterEvent,
  setFilterEvent,
  activeFilterCount,
  openManualModal,
  loadData,
  // selection + chat
  selectedCreator,
  handleSelectCreator,
  handleCloseConversation,
  // children slots
  renderChatContent,
  renderCreatorDetail,
  renderCreatorListItem,
  renderEmptyState,
  // events panel props
  handleOpenCreatorChatFromEvent,
  selectedEventId,
  setSelectedEventId,
  eventPanelRestoreState,
  LIFECYCLE_FILTER_OPTIONS,
}) {
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)

  const visibleTabs = TABS.filter((t) => !t.adminOnly || !ownerLocked)

  const handleTabChange = (key) => {
    if (key !== 'creators') handleCloseConversation?.()
    setActiveTab(key)
  }

  const isInChat = activeTab === 'creators' && selectedCreator
  const showBottomNav = !isInChat

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: WA.shellBg }}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === 'creators' && !selectedCreator && (
          <MobileCreatorListScreen
            search={search}
            setSearch={setSearch}
            creators={creators}
            filteredCreators={filteredCreators}
            loading={loading}
            unreadCounts={unreadCounts}
            filterOwner={filterOwner}
            setFilterOwner={setFilterOwner}
            ownerOptions={ownerOptions}
            ownerLocked={ownerLocked}
            activeFilterCount={activeFilterCount}
            onOpenFilters={() => setFilterSheetOpen(true)}
            openManualModal={openManualModal}
            loadData={loadData}
            onSelect={handleSelectCreator}
            renderItem={renderCreatorListItem}
            renderEmptyState={renderEmptyState}
          />
        )}

        {activeTab === 'creators' && selectedCreator && (
          <MobileChatScreen
            creator={selectedCreator}
            onBack={handleCloseConversation}
            renderChatContent={renderChatContent}
            renderCreatorDetail={renderCreatorDetail}
          />
        )}

        {activeTab === 'events' && (
          <MobileGenericScreen title="事件面板">
            <EventPanel
              onOpenCreatorChat={handleOpenCreatorChatFromEvent}
              selectedEventId={selectedEventId}
              onSelectedEventChange={setSelectedEventId}
              restoreState={eventPanelRestoreState}
            />
          </MobileGenericScreen>
        )}

        {activeTab === 'strategy' && (
          <MobileGenericScreen title="策略配置">
            <div className="p-3 space-y-4">
              <LifecycleConfigPanel embedded />
              <StrategyConfigPanel embedded />
            </div>
          </MobileGenericScreen>
        )}

        {activeTab === 'sft' && (
          <MobileGenericScreen title="SFT 看板">
            <SFTDashboard />
          </MobileGenericScreen>
        )}

        {activeTab === 'accounts' && (
          <MobileGenericScreen title="账号管理">
            <AccountsPanel />
          </MobileGenericScreen>
        )}
      </div>

      {showBottomNav && (
        <MobileBottomNav tabs={visibleTabs} activeTab={activeTab} onChange={handleTabChange} />
      )}

      <MobileBottomSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="筛选"
      >
        <MobileFilterContent
          filterBeta={filterBeta}
          setFilterBeta={setFilterBeta}
          filterPriority={filterPriority}
          setFilterPriority={setFilterPriority}
          filterAgency={filterAgency}
          setFilterAgency={setFilterAgency}
          filterEvent={filterEvent}
          setFilterEvent={setFilterEvent}
          filterLifecycle={filterLifecycle}
          setFilterLifecycle={setFilterLifecycle}
          LIFECYCLE_FILTER_OPTIONS={LIFECYCLE_FILTER_OPTIONS}
          onClear={() => {
            setFilterBeta('')
            setFilterPriority('')
            setFilterAgency('')
            setFilterEvent('')
            setFilterLifecycle('')
          }}
          onClose={() => setFilterSheetOpen(false)}
        />
      </MobileBottomSheet>
    </div>
  )
}

function MobileCreatorListScreen({
  search,
  setSearch,
  creators,
  filteredCreators,
  loading,
  unreadCounts,
  filterOwner,
  setFilterOwner,
  ownerOptions,
  ownerLocked,
  activeFilterCount,
  onOpenFilters,
  openManualModal,
  loadData,
  onSelect,
  renderItem,
  renderEmptyState,
}) {
  return (
    <>
      <MobileScreenHeader
        title="消息"
        subtitle={`${filteredCreators.length} / ${creators.length} 位达人`}
        right={
          <>
            <button
              onClick={openManualModal}
              className="inline-flex items-center justify-center shrink-0 rounded-full text-white font-semibold"
              style={{
                height: 48,
                padding: '0 16px',
                background: WA.teal,
                fontSize: 14,
                letterSpacing: '-0.01em',
              }}
              aria-label="新增达人"
            >
              ＋ 新增
            </button>
            <MobileAuthMenu onRefresh={loadData} loading={loading} />
          </>
        }
      >
        <div className="px-4 pb-3 pt-0 space-y-2.5">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <span style={{ color: WA.textMuted }}>🔍</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索姓名、电话..."
              className="flex-1 bg-transparent text-sm focus:outline-none"
              style={{ color: WA.textDark }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ color: WA.textMuted }} aria-label="清除搜索">
                ✕
              </button>
            )}
          </div>

          {/* Owner pills */}
          <div className="flex items-center gap-2 overflow-x-auto docs-scrollbar -mx-1 px-1 pb-1">
            {ownerOptions.map((o) => {
              const active = filterOwner === o
              return (
                <button
                  key={o}
                  onClick={() => !ownerLocked && setFilterOwner(o)}
                  className="shrink-0 rounded-full border transition-all"
                  style={{
                    minHeight: 40,
                    padding: '0 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: active ? WA.shellActive : WA.white,
                    color: active ? WA.textDark : WA.textMuted,
                    borderColor: active ? WA.shellBorderStrong : WA.borderLight,
                    opacity: ownerLocked ? 0.92 : 1,
                  }}
                >
                  {o === '' ? '全部' : o}
                </button>
              )
            })}
            <button
              onClick={onOpenFilters}
              className="shrink-0 rounded-full border inline-flex items-center gap-1.5"
              style={{
                minHeight: 40,
                padding: '0 14px',
                fontSize: 13,
                fontWeight: 600,
                background: activeFilterCount > 0 ? WA.shellAccentSoft : WA.white,
                color: activeFilterCount > 0 ? WA.teal : WA.textMuted,
                borderColor: activeFilterCount > 0 ? WA.teal : WA.borderLight,
              }}
              aria-label="筛选"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M7 12h10M11 18h2" />
              </svg>
              筛选{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
            </button>
          </div>
        </div>
      </MobileScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto docs-scrollbar" style={{ background: WA.shellBg }}>
        {loading && filteredCreators.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: WA.textMuted }}>加载中...</div>
        ) : filteredCreators.length === 0 ? (
          renderEmptyState ? (
            renderEmptyState()
          ) : (
            <div className="py-12 text-center text-sm" style={{ color: WA.textMuted }}>
              没有找到达人，试着调整筛选条件
            </div>
          )
        ) : (
          <div style={{ background: WA.white }}>
            {filteredCreators.map((c) =>
              renderItem ? (
                renderItem(c, { unread: unreadCounts?.[c.id] || 0, onClick: () => onSelect?.(c) })
              ) : (
                <div key={c.id} />
              )
            )}
          </div>
        )}
      </div>
    </>
  )
}

function MobileChatScreen({ creator, onBack, renderChatContent, renderCreatorDetail }) {
  const [detailOpen, setDetailOpen] = useState(false)
  return (
    <>
      <MobileScreenHeader
        onBack={onBack}
        compact
        title={creator.primary_name || creator.wa_phone || 'Unknown'}
        subtitle={creator.wa_phone ? `${creator.wa_phone}${creator.wa_owner ? ` · ${creator.wa_owner}` : ''}` : (creator.wa_owner || '')}
        right={renderCreatorDetail ? (
          <button
            onClick={() => setDetailOpen(true)}
            className="inline-flex items-center justify-center shrink-0 rounded-full"
            style={{
              width: 44,
              height: 44,
              background: WA.white,
              color: WA.textMuted,
              border: `1px solid ${WA.borderLight}`,
            }}
            aria-label="达人详情"
            title="达人详情"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8h.01M11 12h1v4h1" />
            </svg>
          </button>
        ) : null}
      />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: WA.chatBg }}>
        {renderChatContent?.(creator)}
      </div>
      {detailOpen && renderCreatorDetail && (
        <MobileDetailSheet creator={creator} onClose={() => setDetailOpen(false)}>
          {renderCreatorDetail(creator, () => setDetailOpen(false))}
        </MobileDetailSheet>
      )}
    </>
  )
}

function MobileDetailSheet({ creator, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col"
      style={{ background: WA.shellBg }}
      role="dialog"
      aria-modal="true"
    >
      <MobileScreenHeader
        onBack={onClose}
        compact
        title="达人详情"
        subtitle={creator.primary_name || creator.wa_phone || ''}
      />
      <div className="flex-1 min-h-0 overflow-y-auto docs-scrollbar">
        {children}
      </div>
    </div>
  )
}

function MobileGenericScreen({ title, children }) {
  return (
    <>
      <MobileScreenHeader title={title} right={<MobileAuthMenu />} />
      <div className="flex-1 min-h-0 overflow-y-auto docs-scrollbar" style={{ background: WA.shellBg }}>
        {children}
      </div>
    </>
  )
}

function MobileFilterContent({
  filterBeta,
  setFilterBeta,
  filterPriority,
  setFilterPriority,
  filterAgency,
  setFilterAgency,
  filterEvent,
  setFilterEvent,
  filterLifecycle,
  setFilterLifecycle,
  LIFECYCLE_FILTER_OPTIONS,
  onClear,
  onClose,
}) {
  const FieldSelect = ({ label, value, onChange, options }) => (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-semibold" style={{ color: WA.textMuted }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[44px] px-3 rounded-xl text-[14px]"
        style={{ background: WA.white, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
      >
        {options.map(([val, label]) => (
          <option key={val || 'all'} value={val}>{label}</option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="space-y-4">
      <FieldSelect
        label="Beta 子流程"
        value={filterBeta}
        onChange={setFilterBeta}
        options={[
          ['', '全部'],
          ['not_introduced', '未介绍'],
          ['introduced', '已介绍'],
          ['started', '已开始'],
          ['completed', '已完成'],
        ]}
      />
      <FieldSelect
        label="优先级"
        value={filterPriority}
        onChange={setFilterPriority}
        options={[
          ['', '全部'],
          ['urgent', '紧急'],
          ['high', '高'],
          ['medium', '中'],
          ['low', '低'],
        ]}
      />
      <FieldSelect
        label="Agency"
        value={filterAgency}
        onChange={setFilterAgency}
        options={[
          ['', '全部'],
          ['yes', '已绑定'],
          ['no', '未绑定'],
        ]}
      />
      <FieldSelect
        label="事件"
        value={filterEvent}
        onChange={setFilterEvent}
        options={[
          ['', '全部'],
          ['trial_7day', '7天试用'],
          ['monthly_invited', '月卡邀请'],
          ['monthly_joined', '月卡加入'],
          ['gmv_1k', 'GMV>1K'],
          ['churned', '已流失'],
        ]}
      />
      <FieldSelect
        label="生命周期"
        value={filterLifecycle}
        onChange={setFilterLifecycle}
        options={(LIFECYCLE_FILTER_OPTIONS || []).map((option) => [option.key, option.label])}
      />
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onClear}
          className="flex-1 min-h-[48px] rounded-full text-sm font-semibold"
          style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
        >
          清除全部
        </button>
        <button
          onClick={onClose}
          className="flex-1 min-h-[48px] rounded-full text-sm font-semibold text-white"
          style={{ background: WA.teal }}
        >
          应用
        </button>
      </div>
    </div>
  )
}
