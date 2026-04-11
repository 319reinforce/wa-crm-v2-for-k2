import WA from './waTheme'

function getCreatorMessages(creator) {
  return Array.isArray(creator?._full?.messages) ? creator._full.messages : []
}

function getCreatorStatusMeta(creator) {
  const full = creator?._full || creator || {}
  const wacrm = full.wacrm || {}
  const joinbrands = full.joinbrands || {}
  const urgencyLevel = Number(wacrm.urgency_level || 0)
  const isUrgent = wacrm.priority ***REMOVED***= 'urgent' || urgencyLevel >= 8 || !!joinbrands.ev_churned
  const recentMessagesText = getCreatorMessages(creator).slice(-12).map(m => m?.text || '').join(' ').toLowerCase()
  const isAgencyProspect = !isUrgent && !wacrm.agency_bound && !joinbrands.ev_agency_bound && (
    !!wacrm.agency_bound_at ||
    !!wacrm.agency_deadline ||
    /\b(agency|mcn|contract|sign|signed|binding|bound)\b/.test(recentMessagesText) ||
    /(绑定|签约|机构)/.test(recentMessagesText)
  )

  if (isUrgent) {
    return {
      key: 'urgent',
      label: '紧急跟进',
      bg: 'rgba(251,146,60,0.12)',
      hoverBg: 'rgba(251,146,60,0.18)',
      accent: '#fb923c',
    }
  }

  if (isAgencyProspect) {
    return {
      key: 'agency',
      label: 'Agency 转化中',
      bg: 'rgba(16,185,129,0.10)',
      hoverBg: 'rgba(16,185,129,0.16)',
      accent: '#10b981',
    }
  }

  return {
    key: 'default',
    label: '',
    bg: 'transparent',
    hoverBg: WA.hover,
    accent: 'transparent',
  }
}

export { getCreatorMessages, getCreatorStatusMeta }
