/**
 * StandardReplyCard — 模板槽位卡片
 * 仅负责展示，不主动请求模板数据。
 */
import React, { useState } from 'react';
import WA from '../utils/waTheme';
import EmptyState from './EmptyState';

export default function StandardReplyCard({
    slotLabel,
    badge = 'T',
    accent = '#d97706',
    slot = null,
    alternatives = [],
    loading = false,
    error = null,
    placeholder = '暂无匹配模板',
    onRetry = null,
    onEdit = null,
    onSaveTemplate = null,
    onUpdateTemplate = null,
    onSend = null,
    compactMobile = false,
}) {
    const [expanded, setExpanded] = useState(false);
    const showAlternatives = expanded && Array.isArray(alternatives) && alternatives.length > 0;
    const canUpdateTemplate = Boolean(
        slot?.custom_template_id
        || /^operator-custom-topic::\d+$/.test(String(slot?.section_id || ''))
    );
    const templateActionHandler = canUpdateTemplate ? onUpdateTemplate : onSaveTemplate;

    const cardStyle = {
        width: compactMobile ? '88%' : '72%',
        minWidth: compactMobile ? '280px' : '320px',
        maxWidth: compactMobile ? '360px' : '520px',
        background: '#fffbeb',
        color: WA.textDark,
        border: '1px solid #fde68a',
        boxShadow: '0 1px 1px rgba(217,119,6,0.10)',
    };

    return (
        <div
            className="shrink-0 snap-start rounded-[18px] px-3 py-3"
            style={cardStyle}
        >
            <div className="flex items-center gap-2 mb-2">
                <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: `${accent}20`, color: accent }}
                >
                    {badge}
                </span>
                <span className="text-[11px] font-medium" style={{ color: WA.textMuted }}>
                    {slotLabel}
                </span>
                {slot?.source && (
                    <span className="text-[10px] ml-auto max-w-[40%] truncate" style={{ color: WA.textMuted }}>
                        {formatSourceName(slot.source)}
                    </span>
                )}
            </div>

            <div
                className={`${compactMobile ? 'text-[13px]' : 'text-sm'} leading-relaxed overflow-y-auto`}
                style={{ maxHeight: compactMobile ? '156px' : '132px' }}
            >
                {loading && (
                    <div className="text-xs" style={{ color: WA.textMuted }}>
                        正在加载模板...
                    </div>
                )}

                {!loading && error && (
                    <EmptyState
                        onRetry={onRetry}
                        message={`模板加载失败：${error}`}
                    />
                )}

                {!loading && !error && slot?.text && (
                    <div className="space-y-2">
                        <div className="whitespace-pre-wrap break-words">{slot.text}</div>
                        {slot?.title && (
                            <div className="text-[11px]" style={{ color: WA.textMuted }}>
                                {slot.title}
                            </div>
                        )}
                        {Array.isArray(slot?.matched_by) && slot.matched_by.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {slot.matched_by.slice(0, 3).map((tag) => (
                                    <span
                                        key={tag}
                                        className="px-1.5 py-0.5 rounded-full text-[10px]"
                                        style={{ background: 'rgba(245,158,11,0.12)', color: '#92400e' }}
                                    >
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}
                        {Array.isArray(slot?.media_items) && slot.media_items.length > 0 && (
                            <div className="grid grid-cols-2 gap-2">
                                {slot.media_items.slice(0, 4).map((item, index) => (
                                    <a
                                        key={`${item.url || item.media_asset_id || index}`}
                                        href={item.url || '#'}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="block rounded-lg overflow-hidden"
                                        style={{ border: `1px solid ${WA.borderLight}`, background: WA.white }}
                                    >
                                        {item.url ? (
                                            <img
                                                src={item.url}
                                                alt={item.label || 'template image'}
                                                className="w-full h-20 object-cover"
                                            />
                                        ) : (
                                            <div className="h-20 flex items-center justify-center text-[11px]" style={{ color: WA.textMuted }}>
                                                {item.label || '对应图片'}
                                            </div>
                                        )}
                                        {(item.label || item.note) && (
                                            <div className="px-2 py-1 text-[10px] truncate" style={{ color: WA.textMuted }}>
                                                {item.label || item.note}
                                            </div>
                                        )}
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {!loading && !error && !slot?.text && (
                    <EmptyState onRetry={onRetry} message={placeholder} />
                )}

                {showAlternatives && (
                    <div className="mt-3 space-y-2">
                        {alternatives.map((item) => (
                            <div
                                key={item.section_id}
                                className="rounded-xl px-2.5 py-2"
                                style={{ background: 'rgba(255,255,255,0.78)', border: `1px solid ${WA.borderLight}` }}
                            >
                                <div className="text-[11px] mb-1" style={{ color: WA.textMuted }}>
                                    {item.title || formatSourceName(item.source)}
                                </div>
                                <div className="text-[12px] whitespace-pre-wrap break-words" style={{ color: WA.textDark }}>
                                    {item.text}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="mt-3 flex gap-2 flex-wrap">
                {alternatives.length > 0 && (
                    <button
                        onClick={() => setExpanded((prev) => !prev)}
                        className="px-3 py-2 rounded-full text-[12px] font-semibold"
                        style={{
                            background: 'rgba(255,255,255,0.68)',
                            color: WA.textDark,
                            border: `1px solid ${WA.borderLight}`,
                        }}
                    >
                        {expanded ? '收起备选' : `展开备选 (${alternatives.length})`}
                    </button>
                )}
                {slot?.text && onEdit && (
                    <button
                        onClick={() => onEdit(slot.text, slot)}
                        className="px-3 py-2 rounded-full text-[12px] font-semibold"
                        style={{
                            background: 'rgba(255,255,255,0.68)',
                            color: WA.textDark,
                            border: `1px solid ${WA.borderLight}`,
                        }}
                    >
                        在输入框编辑
                    </button>
                )}
                {slot?.text && templateActionHandler && (
                    <button
                        onClick={() => templateActionHandler(slot)}
                        className="px-3 py-2 rounded-full text-[12px] font-semibold"
                        style={{
                            background: 'rgba(255,255,255,0.68)',
                            color: WA.textDark,
                            border: `1px solid ${WA.borderLight}`,
                        }}
                    >
                        更新模板
                    </button>
                )}
                {slot?.text && onSend && (
                    <button
                        onClick={() => onSend(slot.text, slot)}
                        className="px-3 py-2 rounded-full text-[12px] font-semibold text-white"
                        style={{ background: accent }}
                    >
                        直接发送
                    </button>
                )}
            </div>
        </div>
    );
}

function formatSourceName(source) {
    if (!source) return '';
    if (source.includes('yiyun')) return 'Yiyun';
    if (source.includes('creator-outreach')) return '建联SOP';
    if (source.includes('violation')) return '违规SOP';
    if (source.includes('product')) return '产品/选品';
    if (source.includes('faq')) return 'FAQ';
    return source.split('-')[0] || source;
}
