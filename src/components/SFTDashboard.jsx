import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

export function SFTDashboard() {
  const [stats, setStats] = useState(null)
  const [records, setRecords] = useState([])
  const [pendingRecords, setPendingRecords] = useState([])
  const [abData, setAbData] = useState(null)
  const [trendsData, setTrendsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('records')

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (activeTab ***REMOVED***= 'evaluation') {
      fetch(`${API_BASE}/ab-evaluation`).then(r => r.json()).then(setAbData).catch(console.error)
    }
    if (activeTab ***REMOVED***= 'trends') {
      fetch(`${API_BASE}/sft-memory/trends`).then(r => r.json()).then(setTrendsData).catch(console.error)
    }
    if (activeTab ***REMOVED***= 'review') {
      fetch(`${API_BASE}/sft-memory/pending`).then(r => r.json()).then(setPendingRecords).catch(console.error)
    }
  }, [activeTab])

  const loadData = async () => {
    setLoading(true)
    try {
      const [statsData, recordsData] = await Promise.all([
        fetch(`${API_BASE}/sft-memory/stats`).then(r => r.json()),
        fetch(`${API_BASE}/sft-memory?limit=50`).then(r => r.json())
      ])
      setStats(statsData)
      setRecords(recordsData)
    } catch (e) {
      console.error('加载失败:', e)
    } finally {
      setLoading(false)
    }
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: '#1e293b' }}>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all relative"
              style={{
                background: activeTab ***REMOVED***= key ? '#334155' : 'transparent',
                color: activeTab ***REMOVED***= key ? '#e2e8f0' : '#64748b',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {(activeTab ***REMOVED***= 'records' || activeTab ***REMOVED***= 'review') && (
          <button onClick={loadData} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">
            刷新
          </button>
        )}
      </div>

      {activeTab ***REMOVED***= 'evaluation' ? (
        <ABEvaluationPanel data={abData} loading={!abData} />
      ) : activeTab ***REMOVED***= 'review' ? (
        <ReviewPanel records={pendingRecords} onReviewed={loadData} />
      ) : activeTab ***REMOVED***= 'trends' ? (
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
            <div className="bg-[#1e293b] rounded-xl p-4">
              <div className="text-sm font-medium mb-3 text-slate-300">模型 vs 人工分布</div>
              <div className="flex gap-2 h-4 rounded-full overflow-hidden bg-slate-700">
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
              <div className="flex gap-4 mt-2 text-xs text-slate-400">
                <span>● opt1: {stats.opt1_selected}</span>
                <span>● opt2: {stats.opt2_selected}</span>
                <span>● 人工: {stats.custom_input}</span>
                <span className="ml-auto">人工覆盖率: {stats.model_override_rate}</span>
              </div>
            </div>
          )}

          {/* 最近记录 */}
          <div className="bg-[#1e293b] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700">
              <h3 className="font-semibold text-sm">最近 SFT 记录</h3>
            </div>

            {loading ? (
              <div className="p-8 text-center text-slate-400">加载中...</div>
            ) : records.length ***REMOVED***= 0 ? (
              <div className="p-8 text-center text-slate-500">
                暂无 SFT 记录<br />
                <span className="text-xs">在达人详情中发送消息并审核后将自动生成</span>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {records.map(record => (
                  <div key={record.id} className="px-5 py-4 hover:bg-slate-800/50">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          record.human_selected ***REMOVED***= 'opt1' ? 'bg-blue-500/20 text-blue-400' :
                          record.human_selected ***REMOVED***= 'opt2' ? 'bg-green-500/20 text-green-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>
                          {record.human_selected ***REMOVED***= 'opt1' ? 'A' :
                           record.human_selected ***REMOVED***= 'opt2' ? 'B' : '✍️ 人工'}
                        </span>
                        {record.is_custom_input ? (
                          <span className="text-xs text-amber-400">人工覆盖</span>
                        ) : (
                          <span className="text-xs text-slate-400">模型采用</span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500">{formatDate(record.created_at)}</span>
                    </div>

                    <div className="text-sm text-slate-300 line-clamp-2 mb-1">
                      {record.human_output}
                    </div>

                    {record.human_reason && (
                      <div className="text-xs text-slate-500 italic mt-1">
                        理由: {record.human_reason}
                      </div>
                    )}

                    {record.context && record.context.client_name && (
                      <div className="text-xs text-slate-600 mt-1">
                        客户: {record.context.client_name} · {record.context.client_id}
                      </div>
                    )}
                  </div>
                ))}
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
    blue: 'text-blue-400',
    green: 'text-green-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    slate: 'text-slate-100'
  }
  return (
    <div className="bg-[#1e293b] rounded-xl p-4">
      <div className={`text-2xl font-bold ${colors[color]}`}>{value ?? '-'}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}

function ABEvaluationPanel({ data, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3" style={{ color: '#64748b' }}>
        <span className="text-2xl">⏳</span>
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  if (!data || data.total_records ***REMOVED***= 0) {
    return (
      <div className="text-center py-16" style={{ color: '#64748b' }}>
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

      {/* 分布条 */}
      <div className="bg-[#1e293b] rounded-xl p-4">
        <div className="text-sm font-medium mb-3 text-slate-300">AI 候选 vs 人工选择分布</div>
        <div className="flex gap-2 h-5 rounded-full overflow-hidden bg-slate-700">
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
        <div className="flex gap-4 mt-2 text-xs text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>opt1: {data.opt1_selected}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>opt2: {data.opt2_selected}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>人工: {data.custom_input}</span>
          <span className="ml-auto">模型采纳: {data.opt1_rate + ' + ' + data.opt2_rate} | 人工覆盖: {data.custom_rate}</span>
        </div>
      </div>

      {/* 按场景 */}
      {Object.keys(data.by_scene || {}).length > 0 && (
        <div className="bg-[#1e293b] rounded-xl p-4">
          <div className="text-sm font-medium mb-3 text-slate-300">按场景分布</div>
          <div className="space-y-2">
            {Object.entries(data.by_scene).map(([scene, info]) => {
              const rateNum = parseFloat(info.custom_rate) / 100;
              return (
              <div key={scene} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-28 truncate">{scene}</span>
                <div className="flex-1 flex gap-2 h-4 rounded-full overflow-hidden bg-slate-700">
                  <div className="bg-amber-500" style={{ width: `${(rateNum * 100).toFixed(1)}%` }} />
                </div>
                <span className="text-xs text-slate-400 w-20 text-right">{info.custom_rate} 人工</span>
                <span className="text-xs text-slate-500 w-12 text-right">{info.total}条</span>
              </div>
            )})}
          </div>
        </div>
      )}

      {/* 按负责人 */}
      {Object.keys(data.by_owner || {}).length > 0 && (
        <div className="bg-[#1e293b] rounded-xl p-4">
          <div className="text-sm font-medium mb-3 text-slate-300">按负责人分布</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(data.by_owner).map(([owner, info]) => (
              <div key={owner} className="bg-slate-800 rounded-xl p-3">
                <div className="text-sm font-semibold text-slate-200">{owner}</div>
                <div className="text-2xl font-bold mt-1" style={{ color: '#f59e0b' }}>{info.custom_rate}</div>
                <div className="text-xs text-slate-500 mt-1">人工采纳率 · {info.total}条</div>
                <div className="text-xs text-slate-600 mt-0.5">人工: {info.custom_count}条</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 导出按钮 */}
      <div className="flex gap-3">
        <a href="/api/sft-export?format=jsonl&limit=1000" target="_blank" rel="noreferrer"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-medium text-white">
          📥 导出 JSONL
        </a>
        <a href="/api/sft-export?format=json&limit=1000" target="_blank" rel="noreferrer"
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-xl text-sm font-medium text-white">
          📥 导出 JSON
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
      await fetch(`${API_BASE}/sft-memory/${id}/review`, {
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

  if (records.length ***REMOVED***= 0) {
    return (
      <div className="text-center py-16" style={{ color: '#64748b' }}>
        暂无待审核记录
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-400">
        共 {records.length} 条待审核记录
      </div>
      {records.map(record => (
        <div key={record.id} className="bg-[#1e293b] rounded-xl p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex gap-2">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                record.similarity !***REMOVED*** null && record.similarity < 85
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                相似度: {record.similarity !***REMOVED*** null ? `${record.similarity}%` : '-'}
              </span>
              {record.scene && (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-400">
                  {record.scene}
                </span>
              )}
            </div>
            <span className="text-xs text-slate-500">
              {record.created_at ? new Date(record.created_at).toLocaleString('zh-CN') : '-'}
            </span>
          </div>

          <div className="mb-3">
            <div className="text-xs text-slate-500 mb-1">输入:</div>
            <div className="text-sm text-slate-300 bg-slate-800/50 rounded p-2">
              {record.input_text || record.incoming_text || '-'}
            </div>
          </div>

          {record.model_opt1 && (
            <div className="mb-2">
              <div className="text-xs text-blue-400 mb-1">模型 opt1:</div>
              <div className="text-sm text-slate-300 bg-slate-800/30 rounded p-2">
                {record.model_opt1}
              </div>
            </div>
          )}

          {record.model_opt2 && (
            <div className="mb-2">
              <div className="text-xs text-green-400 mb-1">模型 opt2:</div>
              <div className="text-sm text-slate-300 bg-slate-800/30 rounded p-2">
                {record.model_opt2}
              </div>
            </div>
          )}

          <div className="mb-3">
            <div className="text-xs text-amber-400 mb-1">人工输出:</div>
            <div className="text-sm text-slate-200 bg-amber-500/10 rounded p-2 border border-amber-500/20">
              {record.human_output}
            </div>
          </div>

          {record.human_reason && (
            <div className="text-xs text-slate-500 italic mb-3">
              理由: {record.human_reason}
            </div>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={() => handleReview(record.id, 'approve')}
              disabled={loadingId ***REMOVED***= record.id}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm text-white"
            >
              {loadingId ***REMOVED***= record.id ? '处理中...' : '✓ 通过'}
            </button>
            <button
              onClick={() => handleReview(record.id, 'reject')}
              disabled={loadingId ***REMOVED***= record.id}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg text-sm text-white"
            >
              {loadingId ***REMOVED***= record.id ? '处理中...' : '✗ 拒绝'}
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
      <div className="flex items-center justify-center py-16 gap-3" style={{ color: '#64748b' }}>
        <span className="text-2xl">⏳</span>
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  if (!data || !data.dates || data.dates.length ***REMOVED***= 0) {
    return (
      <div className="text-center py-16" style={{ color: '#64748b' }}>
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

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="opt1 均值" value={data.opt1_rate?.length ? `${(data.opt1_rate.reduce((a, b) => a + b, 0) / data.opt1_rate.length).toFixed(1)}%` : '-'} color="blue" />
        <StatCard label="opt2 均值" value={data.opt2_rate?.length ? `${(data.opt2_rate.reduce((a, b) => a + b, 0) / data.opt2_rate.length).toFixed(1)}%` : '-'} color="green" />
        <StatCard label="人工 均值" value={data.custom_rate?.length ? `${(data.custom_rate.reduce((a, b) => a + b, 0) / data.custom_rate.length).toFixed(1)}%` : '-'} color="amber" />
        <StatCard label="日均条数" value={data.volume?.length ? Math.round(data.volume.reduce((a, b) => a + b, 0) / data.volume.length) : '-'} color="slate" />
      </div>

      <div className="bg-[#1e293b] rounded-xl p-4">
        <div className="text-sm font-medium mb-3 text-slate-300">采用率趋势（近 {data.dates.length} 天）</div>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ minHeight: '200px' }}>
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map(val => (
            <g key={val}>
              <line
                x1={padding.left}
                y1={padding.top + scaleY(val)}
                x2={width - padding.right}
                y2={padding.top + scaleY(val)}
                stroke="#334155"
                strokeWidth="1"
              />
              <text x={padding.left - 5} y={padding.top + scaleY(val) + 4} fill="#64748b" fontSize="10" textAnchor="end">
                {val}%
              </text>
            </g>
          ))}

          {/* Lines */}
          <polyline points={opt1Points} fill="none" stroke="#3b82f6" strokeWidth="2" transform={`translate(${padding.left},${padding.top})`} />
          <polyline points={opt2Points} fill="none" stroke="#22c55e" strokeWidth="2" transform={`translate(${padding.left},${padding.top})`} />
          <polyline points={customPoints} fill="none" stroke="#f59e0b" strokeWidth="2" transform={`translate(${padding.left},${padding.top})`} />

          {/* X-axis labels */}
          {data.dates.filter((_, i) => i % Math.max(1, Math.floor(data.dates.length / 7)) ***REMOVED***= 0).map((date, i, arr) => {
            const idx = data.dates.indexOf(date);
            return (
              <text
                key={date}
                x={padding.left + idx * xStep}
                y={height - 5}
                fill="#64748b"
                fontSize="9"
                textAnchor="middle"
              >
                {date.slice(5)}
              </text>
            );
          })}
        </svg>

        <div className="flex gap-4 mt-2 text-xs text-slate-400 justify-center">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>opt1</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>opt2</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>人工</span>
        </div>
      </div>

      {data.skip_rate && data.skip_rate.some(v => v > 0) && (
        <div className="bg-[#1e293b] rounded-xl p-4">
          <div className="text-sm font-medium mb-3 text-slate-300">跳过率趋势</div>
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ minHeight: '200px' }}>
            {[0, 25, 50, 75, 100].map(val => (
              <g key={val}>
                <line x1={padding.left} y1={padding.top + scaleY(val)} x2={width - padding.right} y2={padding.top + scaleY(val)} stroke="#334155" strokeWidth="1" />
                <text x={padding.left - 5} y={padding.top + scaleY(val) + 4} fill="#64748b" fontSize="10" textAnchor="end">{val}%</text>
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
          <div className="flex gap-4 mt-2 text-xs text-slate-400 justify-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>跳过率</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default SFTDashboard
