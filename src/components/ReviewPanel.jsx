import React, { useState, useEffect } from 'react'

const API_BASE = '/api'

/**
 * ReviewPanel — 审核点 2 人工介入选择界面
 */
export function ReviewPanel({ modelOutput, onClose, onConfirmed }) {
  const [selected, setSelected] = useState(null)
  const [customInput, setCustomInput] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    setSelected(null)
    setCustomInput('')
    setComment('')
    setSuccess(false)
  }, [modelOutput])

  const handleConfirm = async () => {
    const finalOutput = selected ***REMOVED***= 'opt1'
      ? modelOutput.opt1
      : selected ***REMOVED***= 'opt2'
        ? modelOutput.opt2
        : customInput.trim()

    if (!finalOutput) return

    setSubmitting(true)
    try {
      const sftRecord = {
        model_candidates: { opt1: modelOutput.opt1, opt2: modelOutput.opt2 },
        human_selected: selected ***REMOVED***= 'custom' ? 'custom' : selected,
        human_output: finalOutput,
        diff_analysis: {
          model_predicted: selected ***REMOVED***= 'opt1' ? modelOutput.opt1 : selected ***REMOVED***= 'opt2' ? modelOutput.opt2 : null,
          model_rejected: selected ***REMOVED***= 'opt1' ? modelOutput.opt2 : selected ***REMOVED***= 'opt2' ? modelOutput.opt1 : null,
          is_custom: selected ***REMOVED***= 'custom',
          human_reason: comment || null
        },
        context: modelOutput.context || {},
        status: 'approved'
      }

      const res = await fetch(`${API_BASE}/sft-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sftRecord)
      })

      if (!res.ok) throw new Error('保存失败')
      setSuccess(true)
      setTimeout(() => { onConfirmed?.(sftRecord); onClose?.() }, 800)
    } catch (e) {
      console.error('SFT memory 保存失败:', e)
    } finally {
      setSubmitting(false)
    }
  }

  const isValid = selected ***REMOVED***= 'opt1' || selected ***REMOVED***= 'opt2' || (selected ***REMOVED***= 'custom' && customInput.trim())

  if (!modelOutput) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose} />

      {/* 面板 */}
      <div className="fixed left-0 top-0 h-full w-[420px] bg-[#1e293b] shadow-2xl z-50 flex flex-col">

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-600 bg-amber-500/10">
          <div>
            <h2 className="text-base font-bold text-amber-400">⚠️ 审核点 2 — 人工确认</h2>
            <p className="text-xs text-amber-400/70 mt-0.5">请选择最终输出或自行输入</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {/* 选项区 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* opt1 */}
          <OptionCard
            label="方案 A（模型生成）"
            content={modelOutput.opt1}
            selected={selected ***REMOVED***= 'opt1'}
            onClick={() => setSelected('opt1')}
            accent="blue"
          />

          {/* opt2 */}
          <OptionCard
            label="方案 B（模型生成）"
            content={modelOutput.opt2}
            selected={selected ***REMOVED***= 'opt2'}
            onClick={() => setSelected('opt2')}
            accent="green"
          />

          {/* 分隔线 */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-slate-600" />
            <span className="text-xs text-slate-500 font-medium">或 自行输入</span>
            <div className="flex-1 h-px bg-slate-600" />
          </div>

          {/* custom input */}
          <div
            onClick={() => setSelected('custom')}
            className={`rounded-xl border-2 transition-all cursor-pointer ${
              selected ***REMOVED***= 'custom' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-600 bg-slate-800 hover:border-slate-500'
            }`}
          >
            <div className="px-4 py-3">
              <div className="text-xs font-semibold text-amber-400 mb-2">✍️ 人工输入</div>
              <textarea
                value={customInput}
                onChange={e => { setCustomInput(e.target.value); setSelected('custom') }}
                placeholder="在此输入最终输出内容..."
                rows={4}
                className="w-full bg-transparent border-0 focus:outline-none resize-none text-sm text-slate-200 placeholder-slate-500"
              />
            </div>
          </div>

          {/* 人工理由 */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              选择理由 <span className="text-slate-600">(可选，用于强化学习)</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="为什么没有选择模型生成的方案？"
              rows={2}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder-slate-500"
            />
          </div>

          {/* 差异预览 */}
          {selected && (
            <div className="p-3 bg-slate-800 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-slate-300 mb-2">📊 模型预测 vs 实际选择</div>
              {selected !***REMOVED*** 'custom' && (
                <>
                  <div className="flex items-start gap-2">
                    <span className={selected ***REMOVED***= 'opt1' ? 'text-blue-400' : 'text-green-400'}>{selected ***REMOVED***= 'opt1' ? 'A' : 'B'}:</span>
                    <span className="text-slate-400 line-clamp-2 flex-1">{selected ***REMOVED***= 'opt1' ? modelOutput.opt1 : modelOutput.opt2}</span>
                    <span className="text-emerald-400 shrink-0">✓ 选中</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className={selected ***REMOVED***= 'opt1' ? 'text-green-400' : 'text-blue-400'}>{selected ***REMOVED***= 'opt1' ? 'B' : 'A'}:</span>
                    <span className="text-slate-600 line-clamp-2 flex-1">{selected ***REMOVED***= 'opt1' ? modelOutput.opt2 : modelOutput.opt1}</span>
                    <span className="text-red-400 shrink-0">✗ 拒绝</span>
                  </div>
                </>
              )}
              {selected ***REMOVED***= 'custom' && (
                <div className="text-slate-400">使用人工输入替代模型生成</div>
              )}
            </div>
          )}
        </div>

        {/* 底部确认栏 */}
        <div className="px-5 py-4 border-t border-slate-600 bg-slate-800">
          {success ? (
            <div className="text-center text-emerald-400 font-medium py-3">
              ✓ 已保存为强化训练数据
            </div>
          ) : (
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-600 rounded-xl text-slate-300 hover:bg-slate-700 font-medium text-sm">
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={!isValid || submitting}
                className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-40 font-medium text-sm"
              >
                {submitting ? '保存中...' : '✓ 确认输出'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function OptionCard({ label, content, selected, onClick, accent = 'blue' }) {
  const borderColor = selected
    ? accent ***REMOVED***= 'blue' ? 'border-blue-500 bg-blue-500/10' : 'border-green-500 bg-green-500/10'
    : 'border-slate-600 hover:border-slate-500 bg-slate-800'

  return (
    <div onClick={onClick} className={`rounded-xl border-2 transition-all cursor-pointer ${borderColor}`}>
      <div className="px-4 py-3">
        <div className={`text-xs font-semibold mb-2 ${selected ? (accent ***REMOVED***= 'blue' ? 'text-blue-400' : 'text-green-400') : 'text-slate-400'}`}>
          {selected ? '✅ ' : '○ '}{label}
        </div>
        <div className="text-sm text-slate-200 whitespace-pre-wrap line-clamp-5">
          {content || '(空)'}
        </div>
      </div>
    </div>
  )
}

export default ReviewPanel
