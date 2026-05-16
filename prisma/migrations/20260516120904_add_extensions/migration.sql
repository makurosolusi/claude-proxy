-- CreateTable
CREATE TABLE "extensions" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL DEFAULT '',
    "version"      TEXT NOT NULL DEFAULT '0.0.0',
    "enabled"      BOOLEAN NOT NULL DEFAULT false,
    "config"       TEXT NOT NULL DEFAULT '{}',
    "installed_at" BIGINT NOT NULL DEFAULT 0,
    "updated_at"   BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "extensions_pkey" PRIMARY KEY ("id")
);
