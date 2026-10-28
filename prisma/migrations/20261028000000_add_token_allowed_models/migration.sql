-- Per-token model allowlist: satu token boleh diberi beberapa model (mis. haiku + sonnet).
-- Kosong = tanpa batasan; 1 item = perilaku pinned_model lama; >1 item = model yang diminta
-- lolos kalau terdaftar, kalau tidak di-redirect ke elemen pertama (urutan = prioritas).
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS allowed_models TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: token yang sudah di-pin harus berperilaku identik setelah app pindah membaca allowed_models.
UPDATE tokens SET allowed_models = ARRAY[pinned_model]
 WHERE pinned_model <> '' AND cardinality(allowed_models) = 0;
