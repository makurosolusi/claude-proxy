import {
  listExtensions, enableExtension, disableExtension, updateExtensionConfig, getExtension,
} from "../extensions/registry";
import { triggerBroadcast } from "../broadcast";

export async function handleApiExtensions(req: Request, url: URL): Promise<Response> {
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/admin/extensions") {
    return Response.json({ extensions: listExtensions() });
  }

  const enableM = pathname.match(/^\/api\/admin\/extensions\/([a-z][a-z0-9-]*)\/enable$/);
  if (req.method === "POST" && enableM) {
    const id = enableM[1]!;
    if (!getExtension(id)) return Response.json({ ok: false, error: "Extension not registered" }, { status: 404 });
    const res = await enableExtension(id);
    if (!res.ok) return Response.json(res, { status: 400 });
    triggerBroadcast();
    return Response.json({ ok: true });
  }

  const disableM = pathname.match(/^\/api\/admin\/extensions\/([a-z][a-z0-9-]*)\/disable$/);
  if (req.method === "POST" && disableM) {
    const id = disableM[1]!;
    if (!getExtension(id)) return Response.json({ ok: false, error: "Extension not registered" }, { status: 404 });
    const res = await disableExtension(id);
    if (!res.ok) return Response.json(res, { status: 400 });
    triggerBroadcast();
    return Response.json({ ok: true });
  }

  const configM = pathname.match(/^\/api\/admin\/extensions\/([a-z][a-z0-9-]*)\/config$/);
  if (req.method === "POST" && configM) {
    const id = configM[1]!;
    if (!getExtension(id)) return Response.json({ ok: false, error: "Extension not registered" }, { status: 404 });
    let patch: Record<string, any> = {};
    try { patch = await req.json() as Record<string, any>; } catch {}
    const res = await updateExtensionConfig(id, patch);
    if (!res.ok) return Response.json(res, { status: 400 });
    triggerBroadcast();
    return Response.json({ ok: true, config: res.config });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
