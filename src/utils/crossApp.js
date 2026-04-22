// v1 看板已烘焙进 v2 镜像，通过 /v1/ 子路径 serve；跳转用同域绝对路径。
export function buildV1DashboardUrl(options = {}) {
  const params = new URLSearchParams()
  params.set('tab', String(options.tab || 'wa'))
  params.set('source', 'v2')
  if (options.creatorId) params.set('creatorId', String(options.creatorId))
  if (options.openChat) params.set('openChat', '1')
  if (options.phone) params.set('phone', String(options.phone))
  if (options.name) params.set('name', String(options.name))
  return `/v1/?${params.toString()}`
}
