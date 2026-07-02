// Cloudflare Pages Function — lightweight diagnostic.
// Confirms the Function deployed and the Pages secrets are bound, without
// hitting n8n or exposing any data. Use to debug 403/secret-binding issues.
export async function onRequest(context) {
  const { env } = context
  return new Response(
    JSON.stringify({
      ok: true,
      n8n_token: env.N8N_TOKEN ? 'set' : 'MISSING',
      sse_token: env.SSE_TOKEN ? 'set' : 'MISSING',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
