// LIGHT Bookmark: small, read-only Notion pointer index.
// Never treat stored cues as source evidence or current Work truth.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'light-bookmark' });
    if (url.pathname !== '/bookmarks' || request.method !== 'GET') return new Response('Not found', { status: 404 });
    if (!env.BOOKMARKS) return Response.json({ error: 'D1 binding BOOKMARKS missing' }, { status: 503 });
    // A bearer token is required: do not expose private Notion pointers publicly.
    if (!env.LIGHT_BOOKMARK_TOKEN || request.headers.get('Authorization') !== 'Bearer ' + env.LIGHT_BOOKMARK_TOKEN)
      return new Response('Unauthorized', { status: 401 });
    const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit')) || 10));
    const sql = query
      ? 'SELECT id,title,notion_page_id,notion_url,cue,tags,updated_at FROM bookmarks WHERE title LIKE ? OR cue LIKE ? ORDER BY updated_at DESC LIMIT ?'
      : 'SELECT id,title,notion_page_id,notion_url,cue,tags,updated_at FROM bookmarks ORDER BY updated_at DESC LIMIT ?';
    const statement = env.BOOKMARKS.prepare(sql);
    const result = query
      ? await statement.bind('%' + query + '%', '%' + query + '%', limit).all()
      : await statement.bind(limit).all();
    return Response.json({ bookmarks: result.results || [], source_of_truth: 'Notion', read_only: true });
  }
};
