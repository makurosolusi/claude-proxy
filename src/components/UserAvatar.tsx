import { useState } from "react";
import { Box } from "@mantine/core";
import { avatarColor } from "../utils";

function initials(name: string): string {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
}

interface UserAvatarProps {
  name: string;
  imageUrl?: string;
  size?: number;
  /** Show error state (red background, "!" text) */
  isErr?: boolean;
  /** Font size override — defaults to size * 0.36 */
  fz?: number;
}

export function UserAvatar({ name, imageUrl, size = 28, isErr = false, fz }: UserAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const aColor   = avatarColor(name);
  const isDark   = document.documentElement.getAttribute("data-mantine-color-scheme") === "dark";
  const fontSize = fz ?? Math.round(size * 0.36);
  const showImg  = imageUrl && !isErr && !imgFailed;

  if (showImg) {
    return (
      <Box style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        overflow: "hidden", marginTop: 1,
      }}>
        <img
          src={imageUrl}
          alt={name}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          onError={() => setImgFailed(true)}
        />
      </Box>
    );
  }

  return (
    <Box style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: isErr
        ? "var(--cp-red-dim)"
        : `var(--mantine-color-${aColor}-${isDark ? "8" : "1"})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize, fontWeight: 700,
      color: isErr ? "var(--cp-red)" : `var(--mantine-color-${aColor}-6)`,
      fontFamily: "Geist Mono, monospace",
      border: isErr ? "1px solid var(--cp-red-dim)" : "none",
      marginTop: 1,
    }}>
      {isErr ? "!" : initials(name)}
    </Box>
  );
}
