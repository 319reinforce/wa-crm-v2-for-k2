import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchJsonOrThrow } from '../utils/api'
import { isHiddenOwner, useOperatorRoster } from '../utils/operators'
import WA from '../utils/waTheme'

const API_BASE = '/api'

export function ContactManagementPage({
  ownerLocked,
  lockedOwner,
  ownerOptions,
  owner,
  onOwnerChange,
  search,
  onSearchChange,
  showInactive,
  onShowInactiveChange,
  creators,
  selectedCreatorIds,
  selectedVisibleCount,
  allVisibleSelected,
  toggleSelectAllVisible,
  clearSelectedCreators,
  toggleCreatorSelection,
  onOpenCreator,
  applyBatchActiveChange,
  batchTogglingActive,
  activeTogglingCreatorId,
  onToggleCreatorActive,
  onSaveCreatorEdit,
  form,
  onFormChange,
  onSave,
  saving,
  checkLoading,
  checkResult,
  error,
  bulkText,
  onBulkTextChange,
  onBulkSubmit,
  bulkSaving,
  bulkResults,
  bulkError,
  bulkSendWelcome,
  onBulkSendWelcomeChange,
  bulkWelcomeText,
  onBulkWelcomeTextChange,
  bulkWelcomeTemplateKey,
  onBulkWelcomeTemplateKeyChange,
  isAdmin,
  transferPreview,
  transferLoading,
  transferExecuting,
  transferError,
  onLoadTransferPreview,
  onExecuteOwnerTransfer,
  onClearTransferPreview,
}) {
  const [mode, setMode] = useState('single')
  const [transferFromOwner, setTransferFromOwner] = useState('')
  const [transferToOwner, setTransferToOwner] = useState('Yiyun')
  const [editingCreator, setEditingCreator] = useState(null)
  const [editForm, setEditForm] = useState({ primary_name: '', wa_phone: '', wa_owner: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const parsedBulkRows = useMemo(() => parseBulkCreatorRows(bulkText), [bulkText])
  const validBulkRows = useMemo(() => parsedBulkRows.filter(r => r.valid), [parsedBulkRows])
  const samePhone = checkResult?.conflicts?.same_phone || []
  const sameName = checkResult?.conflicts?.same_name || []
  const hasPhoneConflict = samePhone.length > 0
  const hasNameConflict = sameName.length > 0

  const managerOwnerOptions = (() => {
    const merged = new Set()
    for (const item of ownerOptions || []) if (item) merged.add(item)
    if (owner) merged.add(owner)
    if (form?.owner) merged.add(form.owner)
    if (lockedOwner) merged.add(lockedOwner)
    return [...merged]
  })()
  const transferOwnerOptions = (() => {
    const merged = new Set(['Yiyun'])
    for (const item of managerOwnerOptions || []) if (item) merged.add(item)
    if (transferFromOwner && !isHiddenOwner(transferFromOwner)) merged.add(transferFromOwner)
    if (transferToOwner && !isHiddenOwner(transferToOwner)) merged.add(transferToOwner)
    return [...merged].filter((item) => !isHiddenOwner(item))
  })()
  const editOwnerOptions = (() => {
    const merged = new Set(managerOwnerOptions)
    if (editForm.wa_owner) merged.add(editForm.wa_owner)
    if (editingCreator?.wa_owner) merged.add(editingCreator.wa_owner)
    if (lockedOwner) merged.add(lockedOwner)
    return [...merged].filter(Boolean)
  })()
  const openEditCreator = (creator) => {
    setEditingCreator(creator)
    setEditForm({
      primary_name: creator?.primary_name || '',
      wa_phone: creator?.wa_phone || '',
      wa_owner: creator?.wa_owner || lockedOwner || owner || '',
    })
    setEditError('')
  }
  const closeEditCreator = () => {
    if (editSaving) return
    setEditingCreator(null)
    setEditError('')
  }
  const submitEditCreator = async () => {
    if (!editingCreator?.id) return
    const payload = {
      primary_name: String(editForm.primary_name || '').trim(),
      wa_phone: String(editForm.wa_phone || '').trim(),
      wa_owner: String(editForm.wa_owner || '').trim(),
    }
    if (!payload.primary_name || !payload.wa_phone || !payload.wa_owner) {
      setEditError('姓名、电话和负责人都不能为空')
      return
    }
    setEditSaving(true)
    setEditError('')
    try {
      await onSaveCreatorEdit?.(editingCreator.id, payload)
      setEditingCreator(null)
    } catch (e) {
      setEditError(e.message || '保存失败')
    } finally {
      setEditSaving(false)
    }
  }

  return (
    <div className="flex-1 min-w-0 docs-panel overflow-hidden flex flex-col" style={{ background: WA.shellPanelStrong }}>
      <div className="shrink-0 px-6 py-5 border-b" style={{ borderColor: WA.shellBorder }}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="docs-kicker">Contacts</div>
            <div className="text-[28px] leading-none font-semibold" style={{ color: WA.textDark }}>联系人管理</div>
            <div className="text-sm mt-2" style={{ color: WA.textMuted }}>
              新增、批量导入、按 owner 解绑或恢复达人联系人。
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="px-3 py-2 rounded-full text-xs font-medium" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
              当前: <span style={{ color: WA.textDark }}>{owner || '未选择 owner'}</span>
            </div>
            <div className="px-3 py-2 rounded-full text-xs font-medium" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
              列表: <span style={{ color: WA.textDark }}>{creators.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto docs-scrollbar p-5" style={{ background: WA.shellPanel }}>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(420px,520px)_1fr] gap-5 items-start">
          <div className="space-y-4">
            <div className="docs-panel-strong p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="docs-kicker">Owner</div>
                  <div className="text-sm font-semibold mt-1" style={{ color: WA.textDark }}>负责人范围</div>
                </div>
                <select
                  value={owner}
                  onChange={e => onOwnerChange?.(e.target.value)}
                  disabled={ownerLocked}
                  className="px-3 py-2 rounded-xl border text-sm focus:outline-none min-w-40"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
                >
                  {!ownerLocked && !owner && <option value="">请选择 owner</option>}
                  {ownerLocked ? (
                    <option value={lockedOwner}>{lockedOwner}</option>
                  ) : managerOwnerOptions.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto docs-scrollbar pb-1">
                {managerOwnerOptions.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => !ownerLocked && onOwnerChange?.(item)}
                    className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{
                      background: owner === item ? WA.shellActive : WA.white,
                      color: owner === item ? WA.textDark : WA.textMuted,
                      border: `1px solid ${owner === item ? WA.shellBorderStrong : WA.borderLight}`,
                      opacity: ownerLocked ? 0.9 : 1,
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {isAdmin && !ownerLocked && (
              <div className="docs-panel-strong p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="docs-kicker">Transfer</div>
                    <div className="text-sm font-semibold mt-1" style={{ color: WA.textDark }}>联系人迁移</div>
                    <div className="text-xs mt-1" style={{ color: WA.textMuted }}>
                      批量调整联系人 owner 归属，保留历史消息。
                    </div>
                  </div>
                  {transferPreview && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: WA.shellAccentSoft, color: WA.teal }}>
                      {transferPreview.creator_count || 0} 位
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
                  <label className="text-xs space-y-1">
                    <span style={{ color: WA.textMuted }}>来源</span>
                    <select
                      value={transferFromOwner}
                      onChange={e => {
                        setTransferFromOwner(e.target.value)
                        onClearTransferPreview?.()
                      }}
                      disabled={transferLoading || transferExecuting}
                      className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                      style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                    >
                      {transferOwnerOptions.map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <div className="pb-2 text-sm" style={{ color: WA.textMuted }}>→</div>
                  <label className="text-xs space-y-1">
                    <span style={{ color: WA.textMuted }}>目标</span>
                    <select
                      value={transferToOwner}
                      onChange={e => {
                        setTransferToOwner(e.target.value)
                        onClearTransferPreview?.()
                      }}
                      disabled={transferLoading || transferExecuting}
                      className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                      style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                    >
                      {transferOwnerOptions.map(item => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {transferPreview && (
                  <div className="rounded-xl border p-3 text-xs space-y-1" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
                    <div style={{ color: WA.textDark }}>
                      {transferPreview.from_owner} → {transferPreview.to_owner}
                    </div>
                    <div style={{ color: WA.textMuted }}>
                      活跃 {transferPreview.active_creator_count || 0} / 全部 {transferPreview.creator_count || 0} 位联系人
                    </div>
                    <div style={{ color: WA.textMuted }}>
                      roster {transferPreview.roster_count || 0} 条 · 事件 {transferPreview.event_count || 0} 条 · session {transferPreview.target_session_id || '-'}
                    </div>
                  </div>
                )}

                {transferError && (
                  <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                    {transferError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onLoadTransferPreview?.({ fromOwner: transferFromOwner, toOwner: transferToOwner })}
                    disabled={transferLoading || transferExecuting || transferFromOwner === transferToOwner}
                    className="px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                  >
                    {transferLoading ? '读取中...' : '预览'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onExecuteOwnerTransfer?.({ fromOwner: transferFromOwner, toOwner: transferToOwner })}
                    disabled={transferLoading || transferExecuting || transferFromOwner === transferToOwner}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: WA.teal }}
                  >
                    {transferExecuting ? '迁移中...' : '确认迁移'}
                  </button>
                </div>
              </div>
            )}

            <div className="docs-panel-strong p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="docs-kicker">Create</div>
                  <div className="text-sm font-semibold mt-1" style={{ color: WA.textDark }}>
                    {mode === 'bulk' ? '批量导入联系人' : '新增单个联系人'}
                  </div>
                </div>
                <div className="inline-flex rounded-full p-1" style={{ background: WA.shellPanelMuted }}>
                  {[
                    { key: 'single', label: '单个' },
                    { key: 'bulk', label: '批量' },
                  ].map(item => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setMode(item.key)}
                      className="px-3 py-1.5 rounded-full text-xs font-semibold"
                      style={{
                        background: mode === item.key ? WA.white : 'transparent',
                        color: mode === item.key ? WA.textDark : WA.textMuted,
                        border: `1px solid ${mode === item.key ? WA.borderLight : 'transparent'}`,
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'bulk' ? (
                <BulkImportSection
                  ownerLocked={ownerLocked}
                  lockedOwner={lockedOwner}
                  ownerOptions={managerOwnerOptions}
                  owner={owner}
                  onOwnerChange={onOwnerChange}
                  text={bulkText}
                  onTextChange={onBulkTextChange}
                  parsedRows={parsedBulkRows}
                  validRows={validBulkRows}
                  onSubmit={() => onBulkSubmit && onBulkSubmit(validBulkRows)}
                  saving={bulkSaving}
                  results={bulkResults}
                  error={bulkError}
                  sendWelcome={bulkSendWelcome}
                  onSendWelcomeChange={onBulkSendWelcomeChange}
                  welcomeText={bulkWelcomeText}
                  onWelcomeTextChange={onBulkWelcomeTextChange}
                  welcomeTemplateKey={bulkWelcomeTemplateKey}
                  onWelcomeTemplateKeyChange={onBulkWelcomeTemplateKeyChange}
                  onClose={() => setMode('single')}
                />
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="md:col-span-2 text-xs space-y-1">
                      <span style={{ color: WA.textMuted }}>达人姓名</span>
                      <input
                        value={form.name}
                        onChange={e => onFormChange(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="如：Katie"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ borderColor: WA.borderLight, color: WA.textDark }}
                      />
                    </label>
                    <label className="text-xs space-y-1">
                      <span style={{ color: WA.textMuted }}>负责人</span>
                      <select
                        value={form.owner}
                        onChange={e => onFormChange(prev => ({ ...prev, owner: e.target.value }))}
                        disabled={ownerLocked}
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
                      >
                        {ownerLocked ? (
                          <option value={lockedOwner}>{lockedOwner}</option>
                        ) : (
                          <>
                            {!form.owner && <option value="">请选择负责人</option>}
                            {managerOwnerOptions.map(item => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </>
                        )}
                      </select>
                    </label>
                    <label className="md:col-span-3 text-xs space-y-1">
                      <span style={{ color: WA.textMuted }}>WhatsApp 手机号</span>
                      <input
                        value={form.phone}
                        onChange={e => onFormChange(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="如：+1 (318) 701-2419"
                        className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                        style={{ borderColor: WA.borderLight, color: WA.textDark }}
                      />
                    </label>
                  </div>

                  <div className="rounded-xl border p-3 text-xs space-y-2" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
                    {checkLoading ? (
                      <div style={{ color: WA.textMuted }}>去重检查中...</div>
                    ) : checkResult?.ok === false ? (
                      <div style={{ color: '#ef4444' }}>去重检查失败：{checkResult.error || 'unknown error'}</div>
                    ) : (
                      <>
                        <div style={{ color: hasPhoneConflict ? '#ef4444' : '#10b981' }}>
                          同号检查：{hasPhoneConflict ? `发现 ${samePhone.length} 条重复（将复用现有达人）` : '未发现重复手机号'}
                        </div>
                        <div style={{ color: hasNameConflict ? '#f59e0b' : WA.textMuted }}>
                          重名检查：{hasNameConflict ? `发现 ${sameName.length} 条相似姓名` : '未发现相似姓名'}
                        </div>
                      </>
                    )}
                  </div>

                  {error && (
                    <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                      {error}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={onSave}
                      disabled={saving || !form.name?.trim() || !form.phone?.trim() || !form.owner?.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                      style={{ background: WA.teal }}
                    >
                      {saving ? '保存中...' : '保存并建档'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="docs-panel-strong overflow-hidden">
            <div className="p-4 border-b space-y-3" style={{ borderColor: WA.shellBorder }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="docs-kicker">Directory</div>
                  <div className="text-lg font-semibold mt-1" style={{ color: WA.textDark }}>
                    {showInactive ? '已解绑联系人' : '活跃联系人'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onShowInactiveChange(false)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{
                      background: !showInactive ? WA.shellActive : WA.white,
                      color: !showInactive ? WA.textDark : WA.textMuted,
                      border: `1px solid ${!showInactive ? WA.shellBorderStrong : WA.borderLight}`,
                    }}
                  >
                    活跃
                  </button>
                  <button
                    type="button"
                    onClick={() => onShowInactiveChange(true)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold"
                    style={{
                      background: showInactive ? WA.shellActive : WA.white,
                      color: showInactive ? WA.textDark : WA.textMuted,
                      border: `1px solid ${showInactive ? WA.shellBorderStrong : WA.borderLight}`,
                    }}
                  >
                    已解绑
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                <span style={{ color: WA.textMuted }}>🔍</span>
                <input
                  type="text"
                  value={search}
                  onChange={e => onSearchChange?.(e.target.value)}
                  placeholder="搜索姓名、电话、Keeper..."
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                  style={{ color: WA.textDark }}
                />
                {search && <button onClick={() => onSearchChange?.('')} style={{ color: WA.textMuted }}>✕</button>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs" style={{ color: WA.textMuted }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                  <span>全选当前 {creators.length} 位</span>
                </label>
                <div className="flex items-center gap-2">
                  {selectedVisibleCount > 0 && (
                    <button
                      type="button"
                      onClick={clearSelectedCreators}
                      className="px-2.5 py-1.5 rounded-full text-xs font-medium"
                      style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                    >
                      清空
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={applyBatchActiveChange}
                    disabled={selectedVisibleCount === 0 || batchTogglingActive || (!ownerLocked && !owner)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: batchTogglingActive ? '#9ca3af' : (showInactive ? WA.teal : '#dc2626') }}
                  >
                    {batchTogglingActive
                      ? '处理中...'
                      : `${showInactive ? '批量恢复' : '批量解绑'}${selectedVisibleCount > 0 ? ` (${selectedVisibleCount})` : ''}`}
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-320px)] overflow-y-auto docs-scrollbar">
              {creators.length === 0 ? (
                <div className="py-16 text-center text-sm" style={{ color: WA.textMuted }}>没有找到联系人</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: WA.textMuted, background: WA.shellPanelMuted }}>
                      <th className="text-left px-4 py-3 font-medium w-10"></th>
                      <th className="text-left px-4 py-3 font-medium">联系人</th>
                      <th className="text-left px-4 py-3 font-medium">owner</th>
                      <th className="text-left px-4 py-3 font-medium">消息</th>
                      <th className="text-left px-4 py-3 font-medium">状态</th>
                      <th className="text-right px-4 py-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creators.map(creator => (
                      <tr key={creator.id} className="border-t" style={{ borderColor: WA.borderLight }}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedCreatorIds.includes(creator.id)}
                            onChange={() => toggleCreatorSelection?.(creator.id)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold" style={{ color: WA.textDark }}>{creator.primary_name || 'Unknown'}</div>
                          <div className="text-xs font-mono mt-1" style={{ color: WA.textMuted }}>{creator.wa_phone || '-'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{ background: WA.shellAccentSoft, color: WA.teal }}>
                            {creator.wa_owner || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3" style={{ color: WA.textMuted }}>{creator.msg_count || 0}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{
                            background: showInactive ? 'rgba(220,38,38,0.08)' : 'rgba(0,168,132,0.10)',
                            color: showInactive ? '#dc2626' : WA.teal,
                          }}>
                            {showInactive ? '已解绑' : '活跃'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditCreator(creator)}
                              disabled={editSaving}
                              className="px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50"
                              style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleCreatorActive?.(creator)}
                              disabled={batchTogglingActive || activeTogglingCreatorId === creator.id}
                              className="px-3 py-1.5 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                              style={{ background: activeTogglingCreatorId === creator.id ? '#9ca3af' : (showInactive ? WA.teal : '#dc2626') }}
                            >
                              {activeTogglingCreatorId === creator.id
                                ? '处理中...'
                                : (showInactive ? '恢复' : '解绑')}
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenCreator?.(creator)}
                              className="px-3 py-1.5 rounded-full text-xs font-semibold"
                              style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                            >
                              打开
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
      {editingCreator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6" style={{ background: 'rgba(31,29,26,0.42)' }} onMouseDown={closeEditCreator}>
          <div
            className="w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: WA.shellPanelStrong, border: `1px solid ${WA.shellBorder}` }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b flex items-center justify-between gap-3" style={{ borderColor: WA.shellBorder, background: WA.white }}>
              <div>
                <div className="docs-kicker">Edit Contact</div>
                <div className="text-lg font-semibold mt-1" style={{ color: WA.textDark }}>编辑达人</div>
              </div>
              <button
                type="button"
                onClick={closeEditCreator}
                disabled={editSaving}
                className="w-9 h-9 rounded-full text-lg disabled:opacity-50"
                style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
                aria-label="关闭编辑弹窗"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-5" style={{ background: WA.shellPanel }}>
              <label className="block text-sm space-y-2">
                <span style={{ color: WA.textMuted }}>姓名</span>
                <input
                  value={editForm.primary_name}
                  onChange={e => setEditForm(prev => ({ ...prev, primary_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-2xl border text-base focus:outline-none"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                  autoFocus
                />
              </label>
              <label className="block text-sm space-y-2">
                <span style={{ color: WA.textMuted }}>电话</span>
                <input
                  value={editForm.wa_phone}
                  onChange={e => setEditForm(prev => ({ ...prev, wa_phone: e.target.value }))}
                  className="w-full px-4 py-3 rounded-2xl border text-base focus:outline-none"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                />
              </label>
              <label className="block text-sm space-y-2">
                <span style={{ color: WA.textMuted }}>负责人</span>
                <select
                  value={editForm.wa_owner}
                  onChange={e => setEditForm(prev => ({ ...prev, wa_owner: e.target.value }))}
                  disabled={ownerLocked}
                  className="w-full px-4 py-3 rounded-2xl border text-base focus:outline-none"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
                >
                  {!editForm.wa_owner && <option value="">请选择负责人</option>}
                  {editOwnerOptions.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              {editError && (
                <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                  {editError}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex items-center justify-end gap-2" style={{ borderColor: WA.shellBorder, background: WA.white }}>
              <button
                type="button"
                onClick={closeEditCreator}
                disabled={editSaving}
                className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
                style={{ border: `1px solid ${WA.borderLight}`, color: WA.textMuted, background: WA.white }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitEditCreator}
                disabled={editSaving || !editForm.primary_name.trim() || !editForm.wa_phone.trim() || !editForm.wa_owner.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: WA.teal }}
              >
                {editSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function parseBulkCreatorRows(text) {
  const lines = String(text || '').split(/\r?\n/)
  const rows = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) continue
    let name = ''
    let phone = ''
    if (line.includes('\t')) {
      const parts = line.split('\t').map(s => s.trim()).filter(Boolean)
      if (parts.length >= 2) {
        name = parts[0]
        phone = parts.slice(1).join(' ')
      } else {
        name = parts[0] || ''
      }
    } else {
      const m = line.match(/^(.+?)\s{2,}(.+)$/)
      if (m) {
        name = m[1].trim()
        phone = m[2].trim()
      } else {
        const m2 = line.match(/^(.*?)([+\d][\d()\-\s+]{6,})$/)
        if (m2) {
          name = m2[1].trim()
          phone = m2[2].trim()
        } else {
          name = line
        }
      }
    }
    const rawDigits = phone.replace(/\D/g, '')
    const digits = rawDigits.length === 10 ? `1${rawDigits}` : rawDigits
    rows.push({
      lineNo: i + 1,
      raw: line,
      name,
      phone: digits || phone,
      digits,
      valid: Boolean(name) && digits.length >= 7,
      reason: !name ? '缺少姓名' : (digits.length < 7 ? '缺少有效手机号' : ''),
    })
  }
  return rows
}

export function ManualCreatorModal({
  open,
  form,
  ownerLocked,
  lockedOwner,
  onFormChange,
  onClose,
  onSave,
  saving,
  checkLoading,
  checkResult,
  error,
  mode = 'single',
  onModeChange,
  bulkText = '',
  onBulkTextChange,
  onBulkSubmit,
  bulkSaving,
  bulkResults,
  bulkError,
  bulkSendWelcome,
  onBulkSendWelcomeChange,
  bulkWelcomeText,
  onBulkWelcomeTextChange,
  bulkWelcomeTemplateKey,
  onBulkWelcomeTemplateKeyChange,
  availableOwners,
}) {
  const { owners: rosterOwners } = useOperatorRoster()

  const parsedBulkRows = useMemo(() => parseBulkCreatorRows(bulkText), [bulkText])
  const validBulkRows = useMemo(() => parsedBulkRows.filter(r => r.valid), [parsedBulkRows])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  const ownerOptions = (() => {
    const merged = new Set()
    for (const o of (availableOwners || [])) {
      if (o) merged.add(o)
    }
    for (const o of (rosterOwners || [])) {
      if (o) merged.add(o)
    }
    if (form?.owner) merged.add(form.owner)
    return [...merged]
  })()

  const samePhone = checkResult?.conflicts?.same_phone || []
  const sameName = checkResult?.conflicts?.same_name || []
  const hasPhoneConflict = samePhone.length > 0
  const hasNameConflict = sameName.length > 0

  const isBulk = mode === 'bulk'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={isBulk ? '批量导入达人' : '手动录入达人'}>
      <div className="absolute inset-0 bg-black/45" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto" style={{ background: WA.white, borderColor: WA.borderLight }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold" style={{ color: WA.textDark }}>{isBulk ? '批量导入达人' : '手动录入达人'}</div>
            <div className="text-xs mt-1" style={{ color: WA.textMuted }}>
              {isBulk ? '粘贴姓名+电话，每行一条；同号自动复用现有达人' : '录入前自动检查同号与重名，防止重复建档'}
            </div>
          </div>
          <button onClick={onClose} className="text-lg px-2 py-1 rounded-lg" style={{ color: WA.textMuted }}>✕</button>
        </div>

        {onModeChange && (
          <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: WA.borderLight }}>
            {[
              { key: 'single', label: '单个录入' },
              { key: 'bulk', label: 'CSV 批量导入' },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => !saving && !bulkSaving && onModeChange(t.key)}
                className="px-3 py-1.5 text-xs font-medium"
                style={{
                  background: mode === t.key ? WA.teal : 'transparent',
                  color: mode === t.key ? 'white' : WA.textMuted,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {isBulk ? (
          <BulkImportSection
            ownerLocked={ownerLocked}
            lockedOwner={lockedOwner}
            ownerOptions={ownerOptions}
            owner={form?.owner || ''}
            onOwnerChange={(value) => onFormChange(prev => ({ ...prev, owner: value }))}
            text={bulkText}
            onTextChange={onBulkTextChange}
            parsedRows={parsedBulkRows}
            validRows={validBulkRows}
            onSubmit={() => onBulkSubmit && onBulkSubmit(validBulkRows)}
            saving={bulkSaving}
            results={bulkResults}
            error={bulkError}
            sendWelcome={bulkSendWelcome}
            onSendWelcomeChange={onBulkSendWelcomeChange}
            welcomeText={bulkWelcomeText}
            onWelcomeTextChange={onBulkWelcomeTextChange}
            welcomeTemplateKey={bulkWelcomeTemplateKey}
            onWelcomeTemplateKeyChange={onBulkWelcomeTemplateKeyChange}
            onClose={onClose}
          />
        ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="md:col-span-2 text-xs space-y-1">
            <span style={{ color: WA.textMuted }}>达人姓名</span>
            <input
              value={form.name}
              onChange={e => onFormChange(prev => ({ ...prev, name: e.target.value }))}
              placeholder="如：Katie"
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ borderColor: WA.borderLight, color: WA.textDark }}
            />
          </label>
          <label className="text-xs space-y-1">
            <span style={{ color: WA.textMuted }}>负责人</span>
            <select
              value={form.owner}
              onChange={e => onFormChange(prev => ({ ...prev, owner: e.target.value }))}
              disabled={ownerLocked}
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
            >
              {ownerLocked ? (
                <option value={lockedOwner}>{lockedOwner}</option>
              ) : (
                <>
                  {!form.owner && <option value="">请选择负责人</option>}
                  {ownerOptions.map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
                </>
              )}
            </select>
          </label>
          <label className="md:col-span-3 text-xs space-y-1">
            <span style={{ color: WA.textMuted }}>WhatsApp 手机号</span>
            <input
              value={form.phone}
              onChange={e => onFormChange(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="如：+1 (318) 701-2419"
              className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
              style={{ borderColor: WA.borderLight, color: WA.textDark }}
            />
          </label>
        </div>

        <div className="rounded-xl border p-3 text-xs space-y-2" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
          {checkLoading ? (
            <div style={{ color: WA.textMuted }}>去重检查中...</div>
          ) : checkResult?.ok === false ? (
            <div style={{ color: '#ef4444' }}>去重检查失败：{checkResult.error || 'unknown error'}</div>
          ) : (
            <>
              <div style={{ color: hasPhoneConflict ? '#ef4444' : '#10b981' }}>
                同号检查：{hasPhoneConflict ? `发现 ${samePhone.length} 条重复（将复用现有达人）` : '未发现重复手机号'}
              </div>
              <div style={{ color: hasNameConflict ? '#f59e0b' : WA.textMuted }}>
                重名检查：{hasNameConflict ? `发现 ${sameName.length} 条相似姓名` : '未发现相似姓名'}
              </div>
              {(hasPhoneConflict || hasNameConflict) && (
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                  {[...samePhone, ...sameName.filter(item => !samePhone.some(sp => sp.id === item.id))]
                    .slice(0, 6)
                    .map(item => (
                      <div key={item.id} className="px-2 py-1 rounded" style={{ background: WA.white, color: WA.textDark }}>
                        #{item.id} · {item.primary_name || 'Unknown'} · {item.wa_phone || '-'} · {item.wa_owner || '-'}
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 rounded-lg text-sm border"
            style={{ borderColor: WA.borderLight, color: WA.textMuted }}
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name?.trim() || !form.phone?.trim() || !form.owner?.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: WA.teal }}
          >
            {saving ? '保存中...' : '保存并建档'}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  )
}

function BulkImportSection({
  ownerLocked,
  lockedOwner,
  ownerOptions,
  owner,
  onOwnerChange,
  text,
  onTextChange,
  parsedRows,
  validRows,
  onSubmit,
  saving,
  results,
  error,
  sendWelcome,
  onSendWelcomeChange,
  welcomeText,
  onWelcomeTextChange,
  welcomeTemplateKey,
  onWelcomeTemplateKeyChange,
  onClose,
}) {
  const total = parsedRows.length
  const validCount = validRows.length
  const invalidCount = total - validCount
  const summary = results?.summary
  const summaryRows = results?.results || []
  const [templates, setTemplates] = useState([])
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState('')
  const [templateSaving, setTemplateSaving] = useState(false)
  const selectedTemplateKey = welcomeTemplateKey || 'welcome'

  useEffect(() => {
    if (!sendWelcome || !owner) {
      setTemplates([])
      setTemplateError('')
      return
    }
    let cancelled = false
    const load = async () => {
      setTemplateLoading(true)
      setTemplateError('')
      try {
        const params = new URLSearchParams({ owner })
        const data = await fetchJsonOrThrow(`${API_BASE}/creator-import-batches/outreach-templates?${params.toString()}`)
        if (cancelled) return
        const rows = Array.isArray(data?.templates) ? data.templates : []
        setTemplates(rows)
        const preferred = rows.find(t => t.template_key === selectedTemplateKey) || rows.find(t => t.template_key === 'welcome') || rows[0]
        if (preferred) {
          onWelcomeTemplateKeyChange?.(preferred.template_key || 'welcome')
          if (!welcomeText?.trim()) onWelcomeTextChange?.(preferred.body || '')
        }
      } catch (e) {
        if (!cancelled) setTemplateError(e.message || '模板加载失败')
      } finally {
        if (!cancelled) setTemplateLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [owner, sendWelcome])

  const selectedTemplate = templates.find(t => t.template_key === selectedTemplateKey) || null

  const applySelectedTemplate = useCallback((key) => {
    const next = templates.find(t => t.template_key === key)
    onWelcomeTemplateKeyChange?.(key || 'welcome')
    if (next?.body) onWelcomeTextChange?.(next.body)
  }, [templates, onWelcomeTemplateKeyChange, onWelcomeTextChange])

  const saveWelcomeTemplate = useCallback(async () => {
    if (!owner || !welcomeText?.trim()) return
    setTemplateSaving(true)
    setTemplateError('')
    try {
      const data = await fetchJsonOrThrow(`${API_BASE}/creator-import-batches/outreach-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner,
          template_key: selectedTemplateKey || 'welcome',
          label: selectedTemplate?.label || 'Welcome',
          body: welcomeText.trim(),
          is_active: true,
        }),
      })
      const saved = data?.template
      setTemplates(prev => {
        const rest = prev.filter(t => t.template_key !== saved?.template_key)
        return saved ? [saved, ...rest] : prev
      })
      if (saved?.template_key) onWelcomeTemplateKeyChange?.(saved.template_key)
    } catch (e) {
      setTemplateError(e.message || '模板保存失败')
    } finally {
      setTemplateSaving(false)
    }
  }, [owner, onWelcomeTemplateKeyChange, selectedTemplate?.label, selectedTemplateKey, welcomeText])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="md:col-span-1 text-xs space-y-1">
          <span style={{ color: WA.textMuted }}>负责人</span>
          <select
            value={owner}
            onChange={e => onOwnerChange(e.target.value)}
            disabled={ownerLocked || saving}
            className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
            style={{ borderColor: WA.borderLight, color: WA.textDark, background: ownerLocked ? WA.lightBg : WA.white }}
          >
            {ownerLocked ? (
              <option value={lockedOwner}>{lockedOwner}</option>
            ) : (
              <>
                {!owner && <option value="">请选择负责人</option>}
                {ownerOptions.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </>
            )}
          </select>
        </label>
        <div className="md:col-span-2 text-xs flex items-end" style={{ color: WA.textMuted }}>
          支持每行一条，姓名和电话之间可用 Tab、逗号或多个空格分隔。
        </div>
      </div>

      <label className="text-xs space-y-1 block">
        <span style={{ color: WA.textMuted }}>粘贴 CSV / 列表（每行 = 姓名 + 电话）</span>
        <textarea
          value={text}
          onChange={e => onTextChange(e.target.value)}
          rows={8}
          disabled={saving}
          placeholder={'TikTok Tay\t(410) 801-0355\nMarie Lee\t(646) 660-3256\nKerrie Cook\t(717) 847-7055'}
          className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none font-mono"
          style={{ borderColor: WA.borderLight, color: WA.textDark }}
        />
      </label>

      <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-xs" style={{ color: WA.textDark }}>
            <input
              type="checkbox"
              checked={!!sendWelcome}
              onChange={e => onSendWelcomeChange?.(e.target.checked)}
              disabled={saving}
            />
            <span className="font-semibold">发送欢迎消息</span>
            <span
              className="px-2 py-0.5 rounded-full text-[11px]"
              style={{
                color: sendWelcome ? WA.teal : WA.textMuted,
                background: sendWelcome ? 'rgba(15,118,110,0.10)' : WA.white,
                border: `1px solid ${sendWelcome ? 'rgba(15,118,110,0.18)' : WA.borderLight}`,
              }}
            >
              {sendWelcome ? '已开启' : '已关闭'}
            </span>
          </label>
          <div className="text-[11px]" style={{ color: WA.textMuted }}>
            关闭时只导入/绑定 owner，不发送消息，适合已经手动欢迎过但还未入库的历史达人。
          </div>
        </div>
        {sendWelcome && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
              <label className="text-xs space-y-1 block">
                <span style={{ color: WA.textMuted }}>模板池</span>
                <select
                  value={selectedTemplateKey}
                  onChange={e => applySelectedTemplate(e.target.value)}
                  disabled={saving || templateLoading}
                  className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                  style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
                >
                  {!templates.some(t => t.template_key === 'welcome') && (
                    <option value="welcome">{templateLoading ? '加载模板中...' : 'Welcome 默认模板'}</option>
                  )}
                  {templates.map(t => (
                    <option key={t.id || t.template_key} value={t.template_key}>
                      {t.label || t.template_key}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={saveWelcomeTemplate}
                disabled={saving || templateSaving || !owner || !welcomeText?.trim()}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                style={{ background: WA.teal }}
              >
                {templateSaving ? '保存中...' : '保存为模板'}
              </button>
            </div>
            <label className="text-xs space-y-1 block">
              <span style={{ color: WA.textMuted }}>欢迎消息</span>
              <textarea
                value={welcomeText}
                onChange={e => onWelcomeTextChange?.(e.target.value)}
                rows={4}
                disabled={saving}
                placeholder="Hi! This is Jiawei from Moras. I’m reaching out to help with onboarding and creator support."
                className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none"
                style={{ borderColor: WA.borderLight, color: WA.textDark, background: WA.white }}
              />
            </label>
            {templateError && (
              <div className="text-xs" style={{ color: '#ef4444' }}>{templateError}</div>
            )}
          </>
        )}
      </div>

      {total > 0 && (
        <div className="rounded-xl border" style={{ borderColor: WA.borderLight }}>
          <div className="flex items-center justify-between px-3 py-2 text-xs" style={{ background: WA.lightBg, color: WA.textMuted }}>
            <span>预览（{validCount} 条有效 / {invalidCount} 条无效）</span>
            <span>共解析 {total} 行</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: WA.textMuted }}>
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">姓名</th>
                  <th className="text-left px-3 py-2 font-medium">电话</th>
                  <th className="text-left px-3 py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row) => (
                  <tr key={row.lineNo} className="border-t" style={{ borderColor: WA.borderLight }}>
                    <td className="px-3 py-1.5" style={{ color: WA.textMuted }}>{row.lineNo}</td>
                    <td className="px-3 py-1.5" style={{ color: WA.textDark }}>{row.name || <span style={{ color: '#ef4444' }}>—</span>}</td>
                    <td className="px-3 py-1.5 font-mono" style={{ color: WA.textDark }}>{row.phone || <span style={{ color: '#ef4444' }}>—</span>}</td>
                    <td className="px-3 py-1.5">
                      {row.valid ? (
                        <span style={{ color: '#10b981' }}>✓ 待导入</span>
                      ) : (
                        <span style={{ color: '#ef4444' }}>✗ {row.reason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary && (
        <div className="rounded-xl border p-3 text-xs space-y-2" style={{ borderColor: WA.borderLight, background: WA.lightBg }}>
          <div className="flex items-center gap-3 flex-wrap">
            <span style={{ color: WA.textDark }}>导入完成：</span>
            <span style={{ color: '#10b981' }}>新建 {summary.created}</span>
            <span style={{ color: '#0284c7' }}>复用 {summary.reused}</span>
            <span style={{ color: '#f59e0b' }}>跳过 {summary.skipped}</span>
            <span style={{ color: summary.errors > 0 ? '#ef4444' : WA.textMuted }}>失败 {summary.errors}</span>
            {summary.welcome_queued !== undefined && (
              <span style={{ color: '#0284c7' }}>欢迎队列 {summary.welcome_queued}</span>
            )}
          </div>
          {(summary.skipped > 0 || summary.errors > 0) && (
            <div className="max-h-40 overflow-y-auto space-y-1 pt-1">
              {summaryRows.filter(r => r.status === 'error' || r.status === 'skipped').map((r, idx) => (
                <div key={idx} className="px-2 py-1 rounded" style={{ background: WA.white, color: WA.textDark }}>
                  <span style={{ color: '#ef4444' }}>{r.status === 'error' ? '错误' : '跳过'}</span>
                  {' '}· {r.name || '(无名)'} · {r.phone || '(无电话)'} · {r.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-2 rounded-lg text-sm border"
          style={{ borderColor: WA.borderLight, color: WA.textMuted }}
        >
          {summary ? '关闭' : '取消'}
        </button>
        <button
          onClick={onSubmit}
          disabled={saving || validCount === 0 || !owner || (sendWelcome && !welcomeText?.trim())}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: WA.teal }}
        >
          {saving ? '导入中...' : `导入 ${validCount} 条`}
        </button>
      </div>
    </div>
  )
}
