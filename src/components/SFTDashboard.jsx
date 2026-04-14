import React, { useState, useEffect } from 'react'
import { fetchJsonOrThrow, fetchOkOrThrow } from '../utils/api'
import WA from '../utils/waTheme'

const API_BASE = '/api'

export function SFTDashboard() {
  const [stats, setStats] = useState(null)
  const [records, setRecords] = useState([])
  const [pendingRecords, setPendingRecords] = useState([])
  const [abData, setAbData] = useState(null)
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
          const [abEval, ragObs, ragSrc] = await Promise.all([
            fetchJsonOrThrow(`${API_BASE}/ab-evaluation`),
            fetchJsonOrThrow(`${API_BASE}/generation-log/rag-observation?hours=24`),
            fetchJsonOrThrow(`${API_BASE}/generation-log/rag-sources?hours=24&limit=20`),
          ])
          if (!cancelled) {
            setAbData(abEval)
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
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
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
          ragObservation={ragObservation}
          ragSources={ragSources}
          loading={!abData}
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
            <div className="px-5 py-4 border-b" style={{ borderColor: WA.borderLight, background: WA.shellPanelMuted }}>
              <h3 className="font-semibold text-[16px]" style={{ color: WA.textDark }}>最近 SFT 记录</h3>
            </div>

            {loading ? (
              <div className="p-8 text-center" style={{ color: WA.textMuted }}>加载中...</div>
            ) : records.length === 0 ? (
              <div className="p-8 text-center" style={{ color: WA.textMuted }}>
                暂无 SFT 记录<br />
                <span className="text-xs">在达人详情中发送消息并审核后将自动生成</span>
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
    <div className="rounded-[24px] p-5" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
      <div className="text-[34px] font-semibold tracking-[-0.03em]" style={{ color: colors[color] }}>{value ?? '-'}</div>
      <div className="text-[13px] mt-1.5" style={{ color: WA.textMuted }}>{label}</div>
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

function ABEvaluationPanel({ data, ragObservation, ragSources, loading }) {
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
      <div className="text-sm" style={{ color: WA.textMuted }}>
        共 {records.length} 条待审核记录
      </div>
      {records.map(record => (
        <div key={record.id} className="rounded-[22px] p-4" style={{ background: WA.white, border: `1px solid ${WA.borderLight}` }}>
          <div className="flex items-start justify-between mb-2">
            <div className="flex gap-2">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                record.similarity !== null && record.similarity < 85
                  ? 'bg-amber-500/10 text-amber-700'
                  : 'bg-blue-500/10 text-blue-600'
              }`}>
                相似度: {record.similarity !== null ? `${record.similarity}%` : '-'}
              </span>
              {record.scene && (
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: WA.shellPanelMuted, color: WA.textMuted }}>
                  {record.scene}
                </span>
              )}
            </div>
            <span className="text-xs" style={{ color: WA.textMuted }}>
              {record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '-'}
            </span>
          </div>

          <div className="mb-3">
            <div className="text-xs mb-1" style={{ color: WA.textMuted }}>输入:</div>
            <div className="text-sm rounded p-2" style={{ color: WA.textDark, background: WA.shellPanelMuted }}>
              {record.input_text || record.incoming_text || '-'}
            </div>
          </div>

          {record.model_opt1 && (
            <div className="mb-2">
              <div className="text-xs mb-1" style={{ color: '#2563eb' }}>模型 opt1:</div>
              <div className="text-sm rounded p-2" style={{ color: WA.textDark, background: WA.shellPanelMuted }}>
                {record.model_opt1}
              </div>
            </div>
          )}

          {record.model_opt2 && (
            <div className="mb-2">
              <div className="text-xs mb-1" style={{ color: '#0f766e' }}>模型 opt2:</div>
              <div className="text-sm rounded p-2" style={{ color: WA.textDark, background: WA.shellPanelMuted }}>
                {record.model_opt2}
              </div>
            </div>
          )}

          <div className="mb-3">
            <div className="text-xs mb-1" style={{ color: '#b45309' }}>人工输出:</div>
            <div className="text-sm rounded p-2 border" style={{ color: WA.textDark, background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.18)' }}>
              {record.human_output}
            </div>
          </div>

          {record.human_reason && (
            <div className="text-xs italic mb-3" style={{ color: WA.textMuted }}>
              理由: {record.human_reason}
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => handleReview(record.id, 'approve')}
              disabled={loadingId === record.id}
              className="px-4 py-2 disabled:opacity-50 rounded-full text-sm text-white"
              style={{ background: '#0f766e' }}
            >
              {loadingId === record.id ? '处理中...' : '✓ 通过'}
            </button>
            <button
              onClick={() => handleReview(record.id, 'reject')}
              disabled={loadingId === record.id}
              className="px-4 py-2 disabled:opacity-50 rounded-full text-sm text-white"
              style={{ background: '#dc2626' }}
            >
              {loadingId === record.id ? '处理中...' : '✗ 拒绝'}
            </button>
          </div>
        </div>
      ))}
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
