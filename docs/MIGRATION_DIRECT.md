# Migration Plan: cliproxy → Direct Anthropic API

## Status: DRAFT — belum dikerjakan

---

## Temuan dari Research

### Kondisi Sekarang (lebih dekat dari dugaan)

`upstream.ts` **sudah bicara langsung ke Anthropic** untuk usage polling:
```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <access_token>
anthropic-beta: oauth-2025-04-20
```

Artinya **satu-satunya hal yang masih lewat cliproxy** adalah forwarding POST `/v1/messages`.

```
Sekarang:  proxy.ts → http://localhost:8317 (cliproxy) → api.anthropic.com
Target:    proxy.ts → https://api.anthropic.com (langsung)
```

### Struktur Credential File (`claude-*.json`)

```json
{
  "access_token":  "sk-ant-oat01-...",
  "refresh_token": "sk-ant-ort01-...",
  "id_token":      "eyJ...",
  "email":         "user@gmail.com",
  "type":          "...",
  "expired":       false,
  "disabled":      false,
  "last_refresh":  "2026-04-28T..."
}
```

### OAuth Token Refresh

| Field | Value |
|---|---|
| Endpoint | `https://console.anthropic.com/v1/oauth/token` |
| Method | `POST` |
| Body | `{ grant_type: "refresh_token", refresh_token: "...", client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e" }` |
| client_id | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (public, hardcoded di Claude Code) |
| client_secret | Tidak diperlukan (public client flow) |
| Access token TTL | **8 jam (28800 detik)** |
| Refresh token | **Single-use, rotate** — setiap refresh dapat `refresh_token` baru, lama langsung invalid |

---

## Gap Analysis: Apa yang Belum Ada

| Komponen | Sekarang | Yang Dibutuhkan |
|---|---|---|
| Baca `access_token` | ✅ ada di `readOauthToken()` | Sudah ada |
| Poll usage ke Anthropic | ✅ sudah direct | Sudah ada |
| Forward messages direct | ❌ masih ke cliproxy | Perlu diubah di `proxy.ts` |
| Token refresh otomatis | ❌ tidak ada | Perlu ditambah di `upstream.ts` |
| Tulis token baru ke file | ❌ tidak ada | Perlu setelah refresh |
| Rotasi multi-akun | ❌ ambil file pertama saja | Nice-to-have, bukan blocker |
| Handle 401 → refresh → retry | ❌ tidak ada | Perlu di `proxy.ts` |

---

## Rencana Implementasi

### Phase 0 — Prep (tidak ubah behaviour, zero risk)

**Tujuan:** Bersihkan foundation, tidak ada perubahan fungsional.

**`config.ts`** — tambah dua field baru:
```typescript
upstreamMode: (process.env.UPSTREAM_MODE || "cliproxy") as "cliproxy" | "direct",
anthropicUrl: process.env.ANTHROPIC_API_URL || "https://api.anthropic.com",
```

**Catatan:** Default tetap `cliproxy` — semua user tidak merasakan apapun.

---

### Phase 1 — Token Refresh (independent dari proxy mode)

**File:** `src/upstream.ts`

Tambah fungsi `refreshOauthToken()` di bawah `readOauthToken()`:

```typescript
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
let isRefreshing = false; // mutex sederhana

async function refreshOauthToken(filePath: string, refreshToken: string): Promise<string | null> {
  if (isRefreshing) {
    // Tunggu refresh selesai, baca ulang dari cache
    await new Promise(r => setTimeout(r, 1500));
    return upstream.tokenCache.value;
  }
  isRefreshing = true;
  try {
    const resp = await fetch("https://console.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
        client_id:     OAUTH_CLIENT_ID,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      upstream.lastError = `Token refresh HTTP ${resp.status}: ${body.slice(0, 100)}`;
      return null;
    }
    const data = await resp.json() as any;
    // Tulis token baru ke file (refresh token ROTATE — wajib update)
    const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    existing.access_token  = data.access_token;
    existing.refresh_token = data.refresh_token; // token lama sudah invalid setelah ini
    existing.last_refresh  = new Date().toISOString();
    existing.expired       = false;
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    // Update cache
    upstream.tokenCache = { value: data.access_token, readAt: Date.now(), email: existing.email };
    console.log(`[upstream] Token refreshed for ${existing.email}`);
    return data.access_token;
  } catch (e: any) {
    upstream.lastError = "Token refresh error: " + e.message;
    return null;
  } finally {
    isRefreshing = false;
  }
}
```

Update `readOauthToken()` untuk expose `filePath` dan `refresh_token` supaya bisa dipakai saat 401:
```typescript
// Return object lengkap, bukan hanya string
export function getOauthCredential(): { token: string; filePath: string; refreshToken: string } | null
```

**Test Phase 1 (tanpa ubah proxy):**
- Matikan akses manual ke `access_token` → simulate 401 dari usage poll
- Verifikasi file diupdate dengan token baru
- Verifikasi usage poll recover otomatis

---

### Phase 2 — Direct Proxy Mode (feature-flagged)

**File:** `src/handlers/proxy.ts`

Tambah branch di bagian forward:

```typescript
// Ganti bagian "Forward to upstream" dengan:
let upstreamUrl: string;
let authHeader: string;

if (config.upstreamMode === "direct") {
  const cred = getOauthCredential();
  if (!cred) return Response.json(
    { error: { type: "api_error", message: "No valid OAuth token" } },
    { status: 503 }
  );
  upstreamUrl = config.anthropicUrl + pathname;
  authHeader  = "Bearer " + cred.token;
} else {
  upstreamUrl = config.upstream + pathname;
  authHeader  = "Bearer " + config.upstreamKey;
}

const headers = new Headers(req.headers);
headers.set("authorization", authHeader);
if (config.upstreamMode === "direct") {
  headers.set("anthropic-version", "2023-06-01");
  headers.set("anthropic-beta", "oauth-2025-04-20");
  headers.delete("x-api-key");
}
headers.delete("host");

const resp = await fetch(upstreamUrl, { method: "POST", headers, body: bodyText });

// Handle 401 di direct mode → refresh → retry sekali
if (config.upstreamMode === "direct" && resp.status === 401) {
  const cred = getOauthCredential();
  if (cred) {
    const newToken = await refreshOauthToken(cred.filePath, cred.refreshToken);
    if (newToken) {
      headers.set("authorization", "Bearer " + newToken);
      const retryResp = await fetch(upstreamUrl, { method: "POST", headers, body: bodyText });
      // lanjutkan dengan retryResp
    }
  }
}
```

**Test Phase 2 (lokal, mode direct, tidak deploy ke prod):**
- `UPSTREAM_MODE=direct bun dev`
- Kirim beberapa request, verifikasi response identik dengan cliproxy mode
- Verifikasi stream response benar
- Verifikasi token usage tercatat di DB dengan benar
- Verifikasi 401 handling + refresh + retry bekerja

---

### Phase 3 — Shadow Mode di Production

**Tujuan:** Validasi direct mode tanpa risiko apapun ke user.

Tambah flag sementara `SHADOW_DIRECT=true`. Kalau aktif:
- Request tetap diforward ke cliproxy (response ke user)
- **Secara paralel** kirim request yang sama ke Anthropic direct
- Log perbedaan response (status code, token count) ke console
- Tidak ada response direct yang sampai ke user

```typescript
if (process.env.SHADOW_DIRECT === "true" && config.upstreamMode === "cliproxy") {
  // Fire and forget — tidak await, tidak block
  shadowRequest(upstreamUrl, authHeader, bodyText, cred).catch(e =>
    console.warn("[shadow] error:", e.message)
  );
}
```

**Durasi shadow mode:** Minimal 48 jam, lihat log error rate.

**Pass criteria:**
- 0 error dari direct mode selama shadow
- Token count dari direct ≡ dari cliproxy (max diff ±1 karena timing)
- P99 latency direct ≤ cliproxy + 50ms (overhead satu hop hilang, harusnya lebih cepat)

---

### Phase 4 — Canary: Satu Token

Setelah shadow 48 jam bersih, set satu token ke direct mode:

```bash
UPSTREAM_MODE=direct   # ubah default ke direct
# tapi tambah per-token override di DB atau env:
CLIPROXY_TOKENS=sk-user-bagas,sk-user-amel  # token ini tetap ke cliproxy
```

Atau simpler: tambah kolom `mode` di tabel `tokens`:
```sql
ALTER TABLE tokens ADD COLUMN mode TEXT DEFAULT 'inherit';
-- 'inherit' = ikuti UPSTREAM_MODE global
-- 'direct'  = selalu direct
-- 'cliproxy' = selalu via cliproxy
```

Monitor 24 jam. Kalau aman → pindah semua token ke direct.

---

### Phase 5 — Full Cutover

```bash
# Ubah .env
UPSTREAM_MODE=direct

# Bisa hapus (tapi simpan dulu 2 minggu):
# UPSTREAM=http://localhost:8317
# UPSTREAM_KEY=...
```

Kode cliproxy path **tidak dihapus** dulu — tetap ada sebagai emergency fallback.
Rollback: ubah `UPSTREAM_MODE=cliproxy` → restart → selesai (<1 menit).

---

### Phase 6 — Cleanup (2 minggu setelah Phase 5 stabil)

- Hapus cliproxy path di `proxy.ts`
- Hapus `UPSTREAM` dan `UPSTREAM_KEY` dari config
- Hapus shadow mode code
- Update `CLAUDE.md` dan `docs/`
- Commit + push

---

## Risk Matrix

| Risiko | Probability | Impact | Mitigasi |
|---|---|---|---|
| `refresh_token` expired/revoked | Low | High | Detect dari 401 pada refresh call, alert, fallback ke cliproxy |
| Race condition double-refresh | Medium | Medium | `isRefreshing` mutex — hanya satu goroutine refresh sekaligus |
| File write gagal (permission) | Low | High | Try/catch + fallback ke token lama, log error |
| Anthropic ubah OAuth endpoint | Low | High | Feature flag → bisa balik ke cliproxy dalam <1 menit |
| Stream response format beda | Low | Low | Shadow mode detect ini sebelum cutover |
| Token count mismatch vs cliproxy | Low | Low | Shadow mode validasi ini |
| Multiple file rotation logic bug | Medium | Medium | Phase 1 test cover ini sebelum proxy diubah |

---

## Checklist Pre-Launch

Sebelum Phase 4 (canary) boleh jalan:

- [ ] Phase 1: `refreshOauthToken()` ditest manual — simulasi expired token
- [ ] Phase 1: File credential terupdate benar setelah refresh (token baru, `last_refresh`, `expired: false`)
- [ ] Phase 1: `isRefreshing` mutex bekerja — 10 concurrent request tidak double-refresh
- [ ] Phase 2: `UPSTREAM_MODE=direct bun dev` — kirim 20 request, semua 200
- [ ] Phase 2: Stream response ditest — token count tercatat benar di DB
- [ ] Phase 2: Simulate 401 → auto-refresh → retry bekerja
- [ ] Phase 3: Shadow mode jalan 48 jam di prod tanpa error di log
- [ ] Phase 3: Bandingkan token count antara cliproxy dan direct — diff < 1%

---

## File yang Diubah (Summary)

| File | Perubahan | Phase |
|---|---|---|
| `src/config.ts` | Tambah `upstreamMode`, `anthropicUrl` | 0 |
| `src/upstream.ts` | Tambah `refreshOauthToken()`, update `readOauthToken()` → `getOauthCredential()` | 1 |
| `src/handlers/proxy.ts` | Branch `cliproxy` vs `direct`, handle 401 retry, shadow mode | 2–3 |
| `src/state.ts` | (Opsional) Tambah kolom `mode` di tabel `tokens` untuk per-token canary | 4 |
| `.env` | Tambah `UPSTREAM_MODE`, `SHADOW_DIRECT` | 3–5 |
| `docs/ARCHITECTURE.md` | Update env vars table | 6 |
| `docs/LOGIC.md` | Update OAuth section | 6 |

**Total file yang disentuh: 5 src files** — scope kecil, terkontrol.

---

## Estimasi Effort

| Phase | Waktu coding | Waktu validasi |
|---|---|---|
| 0 — Config prep | 15 menit | — |
| 1 — Token refresh | 1–2 jam | 30 menit test |
| 2 — Direct proxy | 1 jam | 1 jam test lokal |
| 3 — Shadow mode | 30 menit | 48 jam observasi |
| 4 — Canary | 15 menit config | 24 jam observasi |
| 5 — Full cutover | 5 menit env change | Monitoring 1 minggu |
| 6 — Cleanup | 30 menit | — |

**Total coding:** ~4–5 jam  
**Total elapsed time:** ~1 minggu (didominasi observasi period)
