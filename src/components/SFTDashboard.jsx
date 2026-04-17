import React, { useState, useEffect, useCallback } from 'react'
import { fetchJsonOrThrow, fetchOkOrThrow } from '../utils/api'
import WA from '../utils/waTheme'

const API_BASE = '/api'

export function SFTDashboard() {
  const [stats, setStats] = useState(null)
  const [records, setRecords] = useState([])
  const [pendingRecords, setPendingRecords] = useState([])
  const [abData, setAbData] = useState(null)
  const [generationStats, setGenerationStats] = useState(null)
  const [generationRecent, setGenerationRecent] = useState([])
  const [ragObservation, setRagObservation] = useState(null)
  const [ragSources, setRagSources] = useState(null)
  const [trendsData, setTrendsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('records')

  useEffect(() => {
    loadData()
  }, [])

  const loadPendingRecords = async () => {
    const data = await fetchJsonOrThrow(`${API_BASE}/sft-memory/pending`)
    setPendingRecords(data)
  }

  useEffect(() => {
    let cancelled = false
    const loadTabData = async () => {
      try {
        if (activeTab === 'evaluation') {
          const [abEval, genStats, genRecent, ragObs, ragSrc] = await Promise.all([
            fetchJsonOrThrow(`${API_BASE}/ab-evaluation`),
            fetchJsonOrThrow(`${API_BASE}/generation-log/stats?days=7`),
            fetchJsonOrThrow(`${API_BASE}/generation-log/recent?limit=20`),
            fetchJsonOrThrow(`${API_BASE}/generation-log/rag-observation?hours=24`),
            fetchJsonOrThrow(`${API_BASE}/generation-log/rag-sources?hours=24&limit=20`),
          ])
          if (!cancelled) {
            setAbData(abEval)
            setGenerationStats(genStats)
            setGenerationRecent(genRecent)
            setRagObservation(ragObs)
            setRagSources(ragSrc)
          }
          return
        }
        if (activeTab === 'trends') {
          const data = await fetchJsonOrThrow(`${API_BASE}/sft-memory/trends`)
          if (!cancelled) setTrendsData(data)
          return
        }
        if (activeTab === 'review') {
          const data = await fetchJsonOrThrow(`${API_BASE}/sft-memory/pending`)
          if (!cancelled) setPendingRecords(data)
        }
      } catch (e) {
        if (!cancelled) console.error(e)
      }
    }
    loadTabData()
    return () => { cancelled = true }
  }, [activeTab])

  const loadData = async () => {
    setLoading(true)
    try {
      const [statsData, recordsData] = await Promise.all([
        fetchJsonOrThrow(`${API_BASE}/sft-memory/stats`),
        fetchJsonOrThrow(`${API_BASE}/sft-memory?limit=50`)
      ])
      setStats(statsData)
      setRecords(recordsData)
    } catch (e) {
      console.error('加载失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    await loadData()
    if (activeTab === 'review') {
      await loadPendingRecords()
    }
  }

  const handleReviewed = async () => {
    await loadData()
    await loadPendingRecords()
  }

  const formatDate = (ts) => {
    if (!ts) return '-'
    return new Date(ts).toLocaleString('zh-CN')
  }

  const TABS = [
    ['records', '语料记录'],
    ['review', `审核${stats?.pending_review ? ` (${stats.pending_review})` : ''}`],
    ['trends', '趋势'],
    ['evaluation', 'A/B 评估'],
  ]

  return (
    <div className="space-y-8 px-6 py-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className="px-4 py-2 rounded-full text-sm font-medium transition-all relative"
              style={{
                background: activeTab === key ? WA.white : WA.shellPanelMuted,
                color: activeTab === key ? WA.textDark : WA.textMuted,
                border: `1px solid ${WA.borderLight}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {(activeTab === 'records' || activeTab === 'review') && (
          <button
            onClick={handleRefresh}
            className="px-4 py-2 rounded-full text-sm font-semibold"
            style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
          >
            刷新
          </button>
        )}
      </div>

      {activeTab === 'evaluation' ? (
        <ABEvaluationPanel
          data={abData}
          generationStats={generationStats}
          generationRecent={generationRecent}
          ragObservation={ragObservation}
          ragSources={ragSources}
          loading={!abData || !generationStats}
        />
      ) : activeTab === 'review' ? (
        <ReviewPanel records={pendingRecords} onReviewed={handleReviewed} />
      ) : activeTab === 'trends' ? (
        <TrendsPanel data={trendsData} loading={!trendsData} />
      ) : (
        <>
          {/* 统计卡片 */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard label="总记录" value={stats.total} color="blue" />
              <StatCard label="模型 opt1" value={stats.opt1_selected} color="blue" />
              <StatCard label="模型 opt2" value={stats.opt2_selected} color="green" />
              <StatCard label="人工输入" value={stats.custom_input} color="amber" />
              <StatCard label="待审核" value={stats.pending_review} color="red" />
            </div>
          )}

          {/* 覆盖率和分布 */}
          {stats && stats.total > 0 && (
            <div className="rounded-[24px] p-5" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
              <div className="text-[16px] font-semibold mb-4" style={{ color: WA.textDark }}>模型 vs 人工分布</div>
              <div className="flex gap-2 h-5 rounded-full overflow-hidden" style={{ background: WA.shellPanelMuted }}>
                {stats.opt1_selected > 0 && (
                  <div
                    className="bg-blue-500 flex items-center justify-center text-xs text-white"
                    style={{ width: `${(stats.opt1_selected / stats.total) * 100}%` }}
                  />
                )}
                {stats.opt2_selected > 0 && (
                  <div
                    className="bg-green-500 flex items-center justify-center text-xs text-white"
                    style={{ width: `${(stats.opt2_selected / stats.total) * 100}%` }}
                  />
                )}
                {stats.custom_input > 0 && (
                  <div
                    className="bg-amber-500 flex items-center justify-center text-xs text-white"
                    style={{ width: `${(stats.custom_input / stats.total) * 100}%` }}
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-3 mt-3 text-[13px]" style={{ color: WA.textMuted }}>
                <span>● opt1: {stats.opt1_selected}</span>
                <span>● opt2: {stats.opt2_selected}</span>
                <span>● 人工: {stats.custom_input}</span>
                <span className="ml-auto">人工覆盖率: {stats.model_override_rate}</span>
              </div>
            </div>
          )}

          {/* 最近记录 */}
          <div className="rounded-[24px] overflow-hidden" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="px-6 py-5 border-b" style={{ borderColor: WA.borderLight, background: WA.shellPanelMuted }}>
              <h3 className="font-semibold text-[16px]" style={{ color: WA.textDark }}>最近 SFT 记录</h3>
            </div>

            {loading ? (
              <div className="p-10 text-center" style={{ color: WA.textMuted }}>加载中...</div>
            ) : records.length === 0 ? (
              <div className="p-10 text-center space-y-2" style={{ color: WA.textMuted }}>
                <div>暂无 SFT 记录</div>
                <div className="text-xs">在达人详情中发送消息并审核后将自动生成</div>
              </div>
            ) : (
              <div className="p-4 md:p-5" style={{ borderTop: `1px solid ${WA.borderLight}` }}>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {records.map(record => {
                    const choiceMeta = getRecordChoiceMeta(record)
                    return (
                      <article
                        key={record.id}
                        className="rounded-[24px] p-5 flex flex-col gap-4"
                        style={{ background: WA.shellPanelStrong, border: `1px solid ${WA.borderLight}`, minHeight: 240 }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="px-3 py-1 rounded-full text-[12px] font-semibold"
                              style={{ background: choiceMeta.bg, color: choiceMeta.color }}
                            >
                              {choiceMeta.badge} {choiceMeta.label}
                            </span>
                            <span
                              className="px-3 py-1 rounded-full text-[12px] font-medium"
                              style={{ background: 'rgba(99,102,241,0.10)', color: '#4f46e5' }}
                            >
                              {buildRecordTopic(record)}
                            </span>
                            {record.is_custom_input && (
                              <span
                                className="px-3 py-1 rounded-full text-[12px] font-medium"
                                style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309' }}
                              >
                                人工覆盖
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 text-[12px]" style={{ color: WA.textMuted }}>
                            {formatDate(record.created_at)}
                          </span>
                        </div>

                        <div className="space-y-2">
                          <div className="text-[22px] font-semibold tracking-[-0.03em]" style={{ color: WA.textDark }}>
                            {buildRecordTitle(record)}
                          </div>
                          <div className="text-[15px] leading-7 line-clamp-4" style={{ color: WA.textDark }}>
                            {record.human_output || '暂无输出内容'}
                          </div>
                        </div>

                        <TraceChips record={record} compact={false} />

                        <div
                          className="rounded-[18px] px-4 py-3 space-y-2"
                          style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}
                        >
                          <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>
                            Reason
                          </div>
                          <div className="text-[13px] leading-6" style={{ color: WA.textMuted }}>
                            {record.human_reason || '暂无补充理由，当前记录已进入语料池待后续复核。'}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {record.context?.client_name && (
                            <span
                              className="px-3 py-1 rounded-full text-[12px]"
                              style={{ background: WA.white, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}
                            >
                              客户 {record.context.client_name}
                            </span>
                          )}
                          {record.context?.client_id && (
                            <span
                              className="px-3 py-1 rounded-full text-[12px]"
                              style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}
                            >
                              #{record.context.client_id}
                            </span>
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, color = 'slate' }) {
  const colors = {
    blue: '#2563eb',
    green: '#0f766e',
    amber: '#b45309',
    red: '#dc2626',
    slate: WA.textDark
  }
  return (
    <div className="rounded-[24px] p-6" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
      <div className="text-[34px] leading-none font-semibold tracking-[-0.03em]" style={{ color: colors[color] }}>{value ?? '-'}</div>
      <div className="text-[13px] mt-4" style={{ color: WA.textMuted }}>{label}</div>
    </div>
  )
}

function getRecordChoiceMeta(record) {
  if (record?.human_selected === 'opt1') {
    return {
      label: '模型 opt1',
      badge: 'A',
      bg: 'rgba(37,99,235,0.12)',
      color: '#2563eb',
    }
  }
  if (record?.human_selected === 'opt2') {
    return {
      label: '模型 opt2',
      badge: 'B',
      bg: 'rgba(15,118,110,0.12)',
      color: '#0f766e',
    }
  }
  return {
    label: '人工输出',
    badge: '✍',
    bg: 'rgba(245,158,11,0.14)',
    color: '#b45309',
  }
}

function buildRecordTitle(record) {
  const name = record?.context?.client_name || record?.context?.creator_name || ''
  if (name) return name
  if (record?.scene) return `${record.scene} 记录`
  return `SFT #${record?.id || '-'}`
}

function buildRecordTopic(record) {
  const candidates = [
    record?.scene,
    record?.context?.topic,
    record?.context?.reason_tag,
    record?.context?.stage,
  ].filter(Boolean)
  return candidates[0] || '语料样本'
}

function buildReviewInput(record) {
  return record?.input_text || record?.incoming_text || record?.context?.input_text || '-'
}

function buildReviewMessages(record) {
  if (!Array.isArray(record?.message_history)) return []
  return record.message_history
    .filter((item) => item && String(item.text || '').trim())
    .slice(-3)
}

function reviewSourceLabel(record) {
  if (record?.context?.source) return String(record.context.source)
  if (record?.reviewed_by) return String(record.reviewed_by)
  return '会话回流'
}

function buildTraceItems(record) {
  const items = []
  const provider = record?.provider || record?.context?.provider
  const model = record?.model || record?.context?.model
  const pipelineVersion = record?.pipeline_version || record?.context?.pipeline_version
  const retrievalId = record?.retrieval_snapshot_id || record?.context?.retrieval_snapshot_id
  const generationId = record?.generation_log_id || record?.context?.generation_log_id

  if (provider) items.push({ label: `Provider ${provider}`, tone: 'teal', type: 'info' })
  if (model) items.push({ label: `Model ${model}`, tone: 'indigo', type: 'info' })
  if (pipelineVersion) items.push({ label: `Pipeline ${pipelineVersion}`, tone: 'slate', type: 'info' })
  if (retrievalId) items.push({ label: `RS #${retrievalId}`, tone: 'emerald', type: 'retrieval', id: retrievalId })
  if (generationId) items.push({ label: `GL #${generationId}`, tone: 'amber', type: 'generation', id: generationId })

  return items
}

function TraceChips({ record, compact = false }) {
  const [expanded, setExpanded] = React.useState(null) // { type, id, data, loading }

  const items = buildTraceItems(record)
  if (items.length === 0) return null

  const handleChipClick = async (item) => {
    if (item.type !== 'generation' && item.type !== 'retrieval') return
    if (expanded?.type === item.type && expanded?.id === item.id) {
      setExpanded(null)
      return
    }
    setExpanded({ type: item.type, id: item.id, data: null, loading: true })
    try {
      const endpoint = item.type === 'generation'
        ? `/api/generation-log/${item.id}`
        : `/api/retrieval-snapshot/${item.id}`
      const res = await fetch(endpoint)
      const data = res.ok ? await res.json() : null
      setExpanded({ type: item.type, id: item.id, data, loading: false })
    } catch (_) {
      setExpanded({ type: item.type, id: item.id, data: null, loading: false })
    }
  }

  return (
    <div className={`space-y-2 ${compact ? '' : 'pt-1'}`}>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => {
          const isClickable = item.type === 'generation' || item.type === 'retrieval'
          const isActive = expanded?.type === item.type && expanded?.id === item.id
          return (
            <TraceChip
              key={item.label}
              label={item.label}
              tone={item.tone}
              compact={compact}
              clickable={isClickable}
              active={isActive}
              onClick={isClickable ? () => handleChipClick(item) : undefined}
            />
          )
        })}
      </div>
      {expanded && (
        <TraceExpandPanel expanded={expanded} onClose={() => setExpanded(null)} />
      )}
    </div>
  )
}

function TraceExpandPanel({ expanded, onClose }) {
  const { type, id, data, loading } = expanded
  return (
    <div
      className="rounded-[16px] p-4 text-[12px] space-y-2"
      style={{ background: 'rgba(0,0,0,0.03)', border: `1px solid rgba(0,0,0,0.07)` }}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold" style={{ color: WA.textDark }}>
          {type === 'generation' ? `Generation Log #${id}` : `Retrieval Snapshot #${id}`}
        </span>
        <button
          onClick={onClose}
          className="text-[11px] px-2 py-0.5 rounded-full"
          style={{ background: WA.shellPanelMuted, color: WA.textMuted }}
        >
          收起
        </button>
      </div>
      {loading && <div style={{ color: WA.textMuted }}>加载中...</div>}
      {!loading && !data && <div style={{ color: '#dc2626' }}>加载失败或记录不存在</div>}
      {!loading && data && type === 'generation' && (
        <div className="space-y-1" style={{ color: WA.textMuted }}>
          <div>provider: <span style={{ color: WA.textDark }}>{data.provider || '-'}</span> · model: <span style={{ color: WA.textDark }}>{data.model || '-'}</span></div>
          <div>route: {data.route || '-'} · ab_bucket: {data.ab_bucket || '-'} · scene: {data.scene || '-'}</div>
          <div>status: <span style={{ color: data.status === 'success' ? '#0f766e' : '#dc2626' }}>{data.status || '-'}</span> · latency: {data.latency_ms ?? '-'}ms · messages: {data.message_count ?? '-'}</div>
          <div>operator: {data.operator || '-'} · prompt_version: {data.prompt_version || '-'}</div>
          {data.retrieval_snapshot_id && <div>RS: #{data.retrieval_snapshot_id}</div>}
          {data.error_message && <div style={{ color: '#dc2626' }}>error: {data.error_message}</div>}
          <div style={{ color: '#94a3b8' }}>{data.created_at ? new Date(data.created_at).toLocaleString('zh-CN') : ''}</div>
        </div>
      )}
      {!loading && data && type === 'retrieval' && (
        <div className="space-y-1" style={{ color: WA.textMuted }}>
          <div>operator: <span style={{ color: WA.textDark }}>{data.operator || '-'}</span> · scene: <span style={{ color: WA.textDark }}>{data.scene || '-'}</span></div>
          <div>prompt_version: {data.system_prompt_version || '-'}</div>
          {data.topic_context && <div>topic: <span style={{ color: WA.textDark }}>{String(data.topic_context).slice(0, 80)}{data.topic_context.length > 80 ? '…' : ''}</span></div>}
          {data.rich_context && <div>rich_ctx: <span style={{ color: WA.textDark }}>{String(data.rich_context).slice(0, 80)}{data.rich_context.length > 80 ? '…' : ''}</span></div>}
          <div style={{ color: '#94a3b8' }}>{data.created_at ? new Date(data.created_at).toLocaleString('zh-CN') : ''}</div>
        </div>
      )}
    </div>
  )
}

function TraceChip({ label, tone = 'slate', compact = false, clickable = false, active = false, onClick }) {
  const tones = {
    teal: { bg: 'rgba(15,118,110,0.10)', color: '#0f766e' },
    indigo: { bg: 'rgba(79,70,229,0.10)', color: '#4338ca' },
    emerald: { bg: 'rgba(5,150,105,0.10)', color: '#047857' },
    amber: { bg: 'rgba(245,158,11,0.12)', color: '#b45309' },
    slate: { bg: WA.shellPanelMuted, color: WA.textMuted },
  }
  const palette = tones[tone] || tones.slate

  return (
    <span
      className={`rounded-full font-medium ${compact ? 'text-[11px] px-2.5 py-1' : 'text-[12px] px-3 py-1'} ${clickable ? 'cursor-pointer select-none' : ''}`}
      style={{
        background: active ? palette.color : palette.bg,
        color: active ? '#fff' : palette.color,
        transition: 'background 0.15s, color 0.15s',
      }}
      onClick={onClick}
    >
      {label}{clickable ? ' ↗' : ''}
    </span>
  )
}

function RecentGenerationCard({ row }) {
  if (!row) return null
  return (
    <div className="rounded-[18px] p-4" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <TraceChip label={`GL #${row.id}`} tone="amber" compact />
          {row.provider && <TraceChip label={row.provider} tone="teal" compact />}
          {row.model && <TraceChip label={row.model} tone="indigo" compact />}
          {row.route && <TraceChip label={`route ${row.route}`} tone="slate" compact />}
          {row.retrieval_snapshot_id && <TraceChip label={`RS #${row.retrieval_snapshot_id}`} tone="emerald" compact />}
        </div>
        <span className="text-[11px]" style={{ color: WA.textMuted }}>
          {row.created_at ? new Date(row.created_at).toLocaleString('zh-CN') : '-'}
        </span>
      </div>
      <div className="mt-3 text-[13px] leading-6" style={{ color: WA.textDark }}>
        client: {row.client_id || '-'} · scene: {row.scene || 'unknown'} · operator: {row.operator || '-'}
      </div>
      <div className="mt-1 text-[12px] leading-6" style={{ color: WA.textMuted }}>
        status: {row.status || '-'} · latency: {row.latency_ms ?? '-'}ms · messages: {row.message_count ?? '-'} · prompt: {row.prompt_version || '-'}
      </div>
      {row.error_message && (
        <div className="mt-2 text-[12px] leading-6" style={{ color: '#dc2626' }}>
          {row.error_message}
        </div>
      )}
    </div>
  )
}

function ABEvaluationPanel({ data, generationStats, generationRecent, ragObservation, ragSources, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
        <span className="text-2xl">⏳</span>
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  if (!data || data.total_records === 0) {
    return (
      <div className="text-center py-16" style={{ color: WA.textMuted }}>
        暂无评估数据<br />
        <span className="text-xs">在达人详情中发送消息后将自动收集数据</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 核心指标 */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-4">
        <StatCard label="总记录" value={data.total_records} color="blue" />
        <StatCard label="人工采纳率" value={data.custom_rate} color="amber" />
        <StatCard label="模型 opt1" value={data.opt1_selected} color="blue" />
        <StatCard label="模型 opt2" value={data.opt2_selected} color="green" />
        <StatCard label="人工输入" value={data.custom_input} color="amber" />
      </div>

      {ragObservation && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="RAG 命中率(24h)" value={ragObservation?.generation?.rag_hit_rate || '-'} color="green" />
          <StatCard label="平均命中片段" value={ragObservation?.generation?.avg_rag_hit_count ?? '-'} color="blue" />
          <StatCard label="人工改写率(24h)" value={ragObservation?.sft?.rewrite_rate || '-'} color="amber" />
          <StatCard label="回复采纳率(24h)" value={ragObservation?.sft?.adoption_rate || '-'} color="green" />
        </div>
      )}

      {generationStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="生成总数(7d)" value={generationStats.total ?? '-'} color="blue" />
          <StatCard label="成功率(7d)" value={generationStats.total ? `${((generationStats.success_count || 0) / generationStats.total * 100).toFixed(1)}%` : '-'} color="green" />
          <StatCard label="平均延迟" value={generationStats.avg_latency_ms != null ? `${generationStats.avg_latency_ms}ms` : '-'} color="amber" />
          <StatCard label="Provider 数" value={generationStats.by_provider?.length || 0} color="slate" />
        </div>
      )}

      {/* 分布条 */}
      <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
        <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>AI 候选 vs 人工选择分布</div>
        <div className="flex gap-2 h-5 rounded-full overflow-hidden" style={{ background: WA.shellPanelMuted }}>
          {data.opt1_selected > 0 && (
            <div className="bg-blue-500 flex items-center justify-center text-xs text-white font-medium"
              style={{ width: `${(data.opt1_selected / data.total_records) * 100}%` }}>
              {data.opt1_selected > 0 ? `${data.opt1_rate}` : ''}
            </div>
          )}
          {data.opt2_selected > 0 && (
            <div className="bg-green-500 flex items-center justify-center text-xs text-white font-medium"
              style={{ width: `${(data.opt2_selected / data.total_records) * 100}%` }}>
              {data.opt2_selected > 0 ? `${data.opt2_rate}` : ''}
            </div>
          )}
          {data.custom_input > 0 && (
            <div className="bg-amber-500 flex items-center justify-center text-xs text-white font-medium"
              style={{ width: `${(data.custom_input / data.total_records) * 100}%` }}>
              {data.custom_input > 0 ? `${data.custom_rate}` : ''}
            </div>
          )}
        </div>
        <div className="flex gap-4 mt-2 text-xs" style={{ color: WA.textMuted }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>opt1: {data.opt1_selected}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>opt2: {data.opt2_selected}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>人工: {data.custom_input}</span>
          <span className="ml-auto">模型采纳: {data.opt1_rate + ' + ' + data.opt2_rate} | 人工覆盖: {data.custom_rate}</span>
        </div>
      </div>

      {/* 按场景 */}
      {Object.keys(data.by_scene || {}).length > 0 && (
        <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
          <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>按场景分布</div>
          <div className="space-y-2">
            {Object.entries(data.by_scene).map(([scene, info]) => {
              const rateNum = parseFloat(info.custom_rate) / 100;
              return (
              <div key={scene} className="flex items-center gap-3">
                <span className="text-xs w-28 truncate" style={{ color: WA.textMuted }}>{scene}</span>
                <div className="flex-1 flex gap-2 h-4 rounded-full overflow-hidden" style={{ background: WA.shellPanelMuted }}>
                  <div className="bg-amber-500" style={{ width: `${(rateNum * 100).toFixed(1)}%` }} />
                </div>
                <span className="text-xs w-20 text-right" style={{ color: WA.textMuted }}>{info.custom_rate} 人工</span>
                <span className="text-xs w-12 text-right" style={{ color: WA.textMuted }}>{info.total}条</span>
              </div>
            )})}
          </div>
        </div>
      )}

      {/* 按负责人 */}
      {Object.keys(data.by_owner || {}).length > 0 && (
        <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
          <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>按负责人分布</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(data.by_owner).map(([owner, info]) => (
              <div key={owner} className="rounded-xl p-3" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
                <div className="text-sm font-semibold" style={{ color: WA.textDark }}>{owner}</div>
                <div className="text-2xl font-bold mt-1" style={{ color: '#f59e0b' }}>{info.custom_rate}</div>
                <div className="text-xs mt-1" style={{ color: WA.textMuted }}>人工采纳率 · {info.total}条</div>
                <div className="text-xs mt-0.5" style={{ color: WA.textMuted }}>人工: {info.custom_count}条</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ragSources?.summary?.top_sources?.length > 0 && (
        <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
          <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>RAG 命中来源 Top（24h）</div>
          <div className="space-y-2">
            {ragSources.summary.top_sources.slice(0, 8).map((item) => (
              <div key={`${item.source_id || item.filename}-${item.source_type}`} className="flex items-center gap-3 text-xs">
                <span className="w-56 truncate" style={{ color: WA.textDark }}>{item.source_id || item.filename || 'unknown'}</span>
                <span className="w-24" style={{ color: WA.textMuted }}>{item.source_type || '-'}</span>
                <span className="text-emerald-400 font-medium">{item.hit_count} 命中</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {generationStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>Provider 分布（7d）</div>
            <div className="space-y-2">
              {(generationStats.by_provider || []).map((item) => (
                <div key={item.provider || 'unknown'} className="flex items-center justify-between text-[13px]">
                  <span style={{ color: WA.textDark }}>{item.provider || 'unknown'}</span>
                  <span style={{ color: WA.textMuted }}>{item.count}</span>
                </div>
              ))}
              {(generationStats.by_provider || []).length === 0 && (
                <div className="text-[12px]" style={{ color: WA.textMuted }}>暂无 provider 数据</div>
              )}
            </div>
          </div>

          <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
            <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>路由分布（7d）</div>
            <div className="space-y-2">
              {(generationStats.by_route || []).map((item) => (
                <div key={item.route || 'unknown'} className="flex items-center justify-between text-[13px]">
                  <span style={{ color: WA.textDark }}>{item.route || 'unknown'}</span>
                  <span style={{ color: WA.textMuted }}>{item.count}</span>
                </div>
              ))}
              {(generationStats.by_route || []).length === 0 && (
                <div className="text-[12px]" style={{ color: WA.textMuted }}>暂无路由数据</div>
              )}
            </div>
          </div>
        </div>
      )}

      {Array.isArray(ragSources?.recent) && ragSources.recent.length > 0 && (
        <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
          <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>最近生成的 RAG 来源（24h）</div>
          <div className="space-y-3 max-h-72 overflow-auto pr-1">
            {ragSources.recent.slice(0, 20).map((row) => (
              <div key={row.id} className="rounded-lg p-3" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs" style={{ color: WA.textMuted }}>#{row.id} · {row.scene || 'unknown'} · hit={row.rag_hit_count || 0}</span>
                  <span className="text-xs" style={{ color: WA.textMuted }}>{new Date(row.created_at).toLocaleString('zh-CN')}</span>
                </div>
                <div className="text-xs mb-1" style={{ color: WA.textMuted }}>client: {row.client_id || '-'} · operator: {row.operator || '-'}</div>
                <div className="flex flex-wrap gap-1">
                  {(row.rag_sources || []).slice(0, 4).map((src, idx) => (
                    <span key={`${row.id}-${idx}`} className="px-2 py-0.5 rounded text-[11px]" style={{ background: WA.white, color: WA.textDark, border: `1px solid ${WA.borderLight}` }}>
                      {src.source_id || src.filename || 'unknown'} ({src.source_type || '-'})
                    </span>
                  ))}
                  {(row.rag_sources || []).length === 0 && (
                    <span className="text-[11px]" style={{ color: WA.textMuted }}>无命中来源</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(generationRecent) && generationRecent.length > 0 && (
        <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
          <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>最近生成日志</div>
          <div className="space-y-3 max-h-96 overflow-auto pr-1">
            {generationRecent.slice(0, 10).map((row) => (
              <RecentGenerationCard key={row.id} row={row} />
            ))}
          </div>
        </div>
      )}

      {/* 导出按钮 */}
      <div className="flex gap-3">
        <a href="/api/sft-export?format=jsonl&limit=1000" target="_blank" rel="noreferrer"
          className="px-4 py-2 rounded-full text-sm font-medium text-white"
          style={{ background: WA.teal }}>
          导出 JSONL
        </a>
        <a href="/api/sft-export?format=json&limit=1000" target="_blank" rel="noreferrer"
          className="px-4 py-2 rounded-full text-sm font-medium"
          style={{ background: WA.white, color: WA.textMuted, border: `1px solid ${WA.borderLight}` }}>
          导出 JSON
        </a>
      </div>
    </div>
  );
}

function ReviewPanel({ records, onReviewed }) {
  const [loadingId, setLoadingId] = useState(null);

  const handleReview = async (id, action) => {
    setLoadingId(id);
    try {
      await fetchOkOrThrow(`${API_BASE}/sft-memory/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      onReviewed();
    } catch (e) {
      console.error('审核失败:', e);
    } finally {
      setLoadingId(null);
    }
  };

  if (records.length === 0) {
    return (
      <div className="text-center py-16" style={{ color: WA.textMuted }}>
        暂无待审核记录
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-[14px]" style={{ color: WA.textMuted }}>
        共 {records.length} 条待审核记录
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {records.map(record => {
          const sourceMessages = buildReviewMessages(record)
          const reviewInput = buildReviewInput(record)
          return (
            <article key={record.id} className="rounded-[24px] p-5 space-y-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-wrap gap-2">
                  <span className={`text-[12px] px-3 py-1 rounded-full font-medium ${
                    record.similarity !== null && record.similarity < 85
                      ? 'bg-amber-500/10 text-amber-700'
                      : 'bg-blue-500/10 text-blue-600'
                  }`}>
                    相似度 {record.similarity !== null ? `${record.similarity}%` : '-'}
                  </span>
                  {record.scene && (
                    <span className="text-[12px] px-3 py-1 rounded-full" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
                      {record.scene}
                    </span>
                  )}
                  <span className="text-[12px] px-3 py-1 rounded-full" style={{ background: 'rgba(15,118,110,0.10)', color: WA.teal }}>
                    原始信源 · {reviewSourceLabel(record)}
                  </span>
                </div>
                <span className="text-[12px]" style={{ color: WA.textMuted }}>
                  {record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '-'}
                </span>
              </div>

              <div className="rounded-[18px] p-4 space-y-2" style={{ background: WA.shellPanelMuted, border: `1px solid ${WA.borderLight}` }}>
                <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>原始输入</div>
                <div className="text-[15px] leading-7" style={{ color: WA.textDark }}>
                  {reviewInput}
                </div>
                {sourceMessages.length > 0 && (
                  <div className="space-y-2 pt-1">
                    {sourceMessages.map((item, idx) => (
                      <div key={`${record.id}_${idx}`} className="rounded-[16px] px-3 py-2.5" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                        <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>
                          {item.role === 'assistant' ? 'Operator' : item.role === 'user' ? 'Creator' : item.role || 'Message'}
                        </div>
                        <div className="text-[13px] mt-1 leading-6" style={{ color: WA.textDark }}>
                          {item.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {record.model_opt1 && (
                  <div className="rounded-[18px] p-4" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)' }}>
                    <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: '#2563eb' }}>模型 opt1</div>
                    <div className="text-[14px] mt-2 leading-6" style={{ color: WA.textDark }}>{record.model_opt1}</div>
                  </div>
                )}
                {record.model_opt2 && (
                  <div className="rounded-[18px] p-4" style={{ background: 'rgba(15,118,110,0.06)', border: '1px solid rgba(15,118,110,0.12)' }}>
                    <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: '#0f766e' }}>模型 opt2</div>
                    <div className="text-[14px] mt-2 leading-6" style={{ color: WA.textDark }}>{record.model_opt2}</div>
                  </div>
                )}
              </div>

              <div className="rounded-[18px] p-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}>
                <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: '#b45309' }}>人工输出</div>
                <div className="text-[15px] mt-2 leading-7" style={{ color: WA.textDark }}>{record.human_output}</div>
              </div>

              <TraceChips record={record} compact={false} />

              <div className="rounded-[18px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
                <div className="text-[11px] font-semibold tracking-[0.08em] uppercase" style={{ color: WA.textMuted }}>审核说明</div>
                <div className="text-[13px] mt-2 leading-6" style={{ color: WA.textMuted }}>
                  {record.human_reason || '暂无额外说明，建议结合原始信源与候选回复进行快速人工判断。'}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => handleReview(record.id, 'approve')}
                  disabled={loadingId === record.id}
                  className="px-4 py-2.5 disabled:opacity-50 rounded-full text-[14px] text-white font-medium"
                  style={{ background: '#0f766e' }}
                >
                  {loadingId === record.id ? '处理中...' : '✓ 通过'}
                </button>
                <button
                  onClick={() => handleReview(record.id, 'reject')}
                  disabled={loadingId === record.id}
                  className="px-4 py-2.5 disabled:opacity-50 rounded-full text-[14px] text-white font-medium"
                  style={{ background: '#dc2626' }}
                >
                  {loadingId === record.id ? '处理中...' : '✗ 拒绝'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  );
}

function TrendsPanel({ data, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3" style={{ color: WA.textMuted }}>
        <span className="text-2xl">⏳</span>
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  if (!data || !data.dates || data.dates.length === 0) {
    return (
      <div className="text-center py-16" style={{ color: WA.textMuted }}>
        暂无趋势数据<br />
        <span className="text-xs">开始使用后数据将自动积累</span>
      </div>
    );
  }

  // Simple SVG line chart
  const width = 800;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxVal = 100;
  const xStep = chartWidth / (data.dates.length - 1 || 1);

  const scaleY = (val) => chartHeight - (val / maxVal) * chartHeight;

  const opt1Points = data.dates.map((_, i) => {
    const val = data.opt1_rate?.[i] ?? 0;
    return `${i * xStep},${scaleY(val)}`;
  }).join(' ');

  const opt2Points = data.dates.map((_, i) => {
    const val = data.opt2_rate?.[i] ?? 0;
    return `${i * xStep},${scaleY(val)}`;
  }).join(' ');

  const customPoints = data.dates.map((_, i) => {
    const val = data.custom_rate?.[i] ?? 0;
    return `${i * xStep},${scaleY(val)}`;
  }).join(' ');

  // Backward/forward compatible: backend historically used `volumes`, some code read `volume`.
  const trendVolumes = Array.isArray(data.volumes)
    ? data.volumes
    : (Array.isArray(data.volume) ? data.volume : []);
  const avgVolume = trendVolumes.length
    ? Math.round(trendVolumes.reduce((sum, item) => sum + (Number(item) || 0), 0) / trendVolumes.length)
    : '-';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="opt1 均值" value={data.opt1_rate?.length ? `${(data.opt1_rate.reduce((a, b) => a + b, 0) / data.opt1_rate.length).toFixed(1)}%` : '-'} color="blue" />
        <StatCard label="opt2 均值" value={data.opt2_rate?.length ? `${(data.opt2_rate.reduce((a, b) => a + b, 0) / data.opt2_rate.length).toFixed(1)}%` : '-'} color="green" />
        <StatCard label="人工 均值" value={data.custom_rate?.length ? `${(data.custom_rate.reduce((a, b) => a + b, 0) / data.custom_rate.length).toFixed(1)}%` : '-'} color="amber" />
        <StatCard label="日均条数" value={avgVolume} color="slate" />
      </div>

      <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
        <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>采用率趋势（近 {data.dates.length} 天）</div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ minHeight: '200px' }}>
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map(val => (
            <g key={val}>
              <line
                x1={padding.left}
                y1={padding.top + scaleY(val)}
                x2={width - padding.right}
                y2={padding.top + scaleY(val)}
                stroke={WA.borderLight}
                strokeWidth="1"
              />
              <text x={padding.left - 5} y={padding.top + scaleY(val) + 4} fill={WA.textMuted} fontSize="10" textAnchor="end">
                {val}%
              </text>
            </g>
          ))}

          {/* Lines */}
          <polyline points={opt1Points} fill="none" stroke="#3b82f6" strokeWidth="2" transform={`translate(${padding.left},${padding.top})`} />
          <polyline points={opt2Points} fill="none" stroke="#22c55e" strokeWidth="2" transform={`translate(${padding.left},${padding.top})`} />
          <polyline points={customPoints} fill="none" stroke="#f59e0b" strokeWidth="2" transform={`translate(${padding.left},${padding.top})`} />

          {/* X-axis labels */}
          {data.dates.filter((_, i) => i % Math.max(1, Math.floor(data.dates.length / 7)) === 0).map((date, i, arr) => {
            const idx = data.dates.indexOf(date);
            return (
              <text
                key={date}
                x={padding.left + idx * xStep}
                y={height - 5}
                fill={WA.textMuted}
                fontSize="9"
                textAnchor="middle"
              >
                {date.slice(5)}
              </text>
            );
          })}
        </svg>

        <div className="flex gap-4 mt-2 text-xs justify-center" style={{ color: WA.textMuted }}>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>opt1</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>opt2</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>人工</span>
        </div>
      </div>

      {data.skip_rate && data.skip_rate.some(v => v > 0) && (
        <div className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
          <div className="text-sm font-medium mb-3" style={{ color: WA.textDark }}>跳过率趋势</div>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ minHeight: '200px' }}>
            {[0, 25, 50, 75, 100].map(val => (
              <g key={val}>
                <line x1={padding.left} y1={padding.top + scaleY(val)} x2={width - padding.right} y2={padding.top + scaleY(val)} stroke={WA.borderLight} strokeWidth="1" />
                <text x={padding.left - 5} y={padding.top + scaleY(val) + 4} fill={WA.textMuted} fontSize="10" textAnchor="end">{val}%</text>
              </g>
            ))}
            <polyline
              points={data.skip_rate.map((v, i) => `${i * xStep},${scaleY(v)}`).join(' ')}
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              transform={`translate(${padding.left},${padding.top})`}
            />
          </svg>
          <div className="flex gap-4 mt-2 text-xs justify-center" style={{ color: WA.textMuted }}>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>跳过率</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default SFTDashboard
