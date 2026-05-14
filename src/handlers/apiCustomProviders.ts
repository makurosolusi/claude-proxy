import {
  getCustomProviders, upsertCustomProvider, deleteCustomProvider,
  validateNewProvider, type CustomProvider,
} from "../customProviders";

// GET  /api/admin/custom-providers
// POST /api/admin/custom-providers — body: CustomProvider (create or update by id)
// DELETE /api/admin/custom-providers/:id

export async function handleApiCustomProviders(req: Request, url: URL): Promise<Response> {
  if (req.method === "GET") {
    const list = getCustomProviders();
    // Mask api_key for list response (security: don't echo full key back)
    const safe = list.map(p => ({
      ...p,
      api_key:        p.api_key ? `…${p.api_key.slice(-6)}` : "",
      api_key_set:    !!p.api_key,
    }));
    return Response.json({ providers: safe });
  }

  if (req.method === "POST") {
    let body: any;
    try { body = await req.json(); }
    catch { return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 }); }

    const isUpdate = body?._update === true;
    const existing = getCustomProviders();
    const existingIds = existing.map(p => p.id);

    if (isUpdate) {
      // Updating: id must already exist
      if (!existingIds.includes(body.id)) {
        return Response.json({ ok: false, error: `Provider "${body.id}" not found` }, { status: 404 });
      }
      // If api_key is masked (starts with …) keep the original
      const original = existing.find(p => p.id === body.id)!;
      if (typeof body.api_key === "string" && body.api_key.startsWith("…")) {
        body.api_key = original.api_key;
      }
    } else {
      // Creating: id must not exist
      if (existingIds.includes(body.id)) {
        return Response.json({ ok: false, error: `Provider "${body.id}" already exists. Use _update:true to modify.` }, { status: 409 });
      }
    }

    // Validate (skip id-exists check for updates)
    const validateIds = isUpdate ? existingIds.filter(id => id !== body.id) : existingIds;
    const err = validateNewProvider(body, validateIds);
    if (err) return Response.json({ ok: false, error: err }, { status: 400 });

    const provider: CustomProvider = {
      id:            body.id.trim(),
      name:          body.name.trim(),
      type:          body.type,
      base_url:      body.base_url.trim().replace(/\/$/, ""),
      api_key:       body.api_key.trim(),
      color:         body.color || "gray",
    };
    await upsertCustomProvider(provider);
    return Response.json({ ok: true, provider: { ...provider, api_key: `…${provider.api_key.slice(-6)}` } });
  }

  if (req.method === "DELETE") {
    const m = url.pathname.match(/^\/api\/admin\/custom-providers\/([a-z0-9-]+)$/);
    if (!m) return Response.json({ ok: false, error: "Missing provider id in URL" }, { status: 400 });
    const id = m[1]!;
    await deleteCustomProvider(id);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
}
