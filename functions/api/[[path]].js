// Cloudflare Pages Function — proxy NO.Rack API calls to n8n.
// The n8n bearer token lives server-side in env.N8N_TOKEN (Pages secret),
// never in the client bundle. The whole Pages app is behind Cloudflare Access,
// so /api/* is reachable only by authenticated staff.
const N8N_BASE = 'https://n8nlocal.winterarmy.net/webhook'

export async function onRequest(context) {
  const { request, env, params } = context
  const sub = Array.isArray(params.path) ? params.path.join('/') : (params.path || '')
  const url = new URL(request.url)
  const target = `${N8N_BASE}/${sub}${url.search}`

  const headers = { Authorization: env.N8N_TOKEN }
  const contentType = request.headers.get('content-type')
  if (contentType) headers['Content-Type'] = contentType

  const init = { method: request.method, headers }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text()
  }

  const resp = await fetch(target, init)
  const out = new Headers()
  out.set('Content-Type', resp.headers.get('content-type') || 'application/json')
  return new Response(resp.body, { status: resp.status, headers: out })
}
