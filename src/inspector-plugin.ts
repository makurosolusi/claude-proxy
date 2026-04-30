import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

export function inspectorPlugin(): Plugin {
  const rootDir = process.cwd();
  return {
    name: "inspector-inject",
    enforce: "pre",
    transform(code, id) {
      if (!/\.[jt]sx(\?|$)/.test(id) || id.includes("node_modules"))
        return null;
      if (!code.includes("<")) return null;

      const cleanId = id.replace(/\?.*$/, "");
      const relativePath = path.relative(rootDir, cleanId).replace(/\\/g, "/");

      // Read original file from disk for accurate line numbers
      // (received code may already be transformed by other plugins)
      let originalLines: string[] | null = null;
      try {
        originalLines = fs.readFileSync(cleanId, "utf-8").split("\n");
      } catch {}

      let modified = false;
      let lastOrigIdx = 0;
      const lines = code.split("\n");
      const result: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        // Match both React components (PascalCase) and HTML tags (lowercase)
        const jsxPattern =
          /(<(?:[A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*|[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*))\b/g;
        let match: RegExpExecArray | null = jsxPattern.exec(line);

        while (match !== null) {
          // Skip if preceded by identifier char (TypeScript generic, not JSX)
          const charBefore = match.index > 0 ? line[match.index - 1] : "";
          if (/[a-zA-Z0-9_$.]/.test(charBefore)) {
            match = jsxPattern.exec(line);
            continue;
          }

          let actualLine = i + 1;
          if (originalLines) {
            const afterTag = line.slice(match.index);
            const snippet = afterTag
              .split(">")[0]
              .replace(/\s*data-inspector-[^"]*"[^"]*"/g, "")
              .trim();
            const tagName = match[1];
            let found = false;

            // Strategy 1: forward search with full snippet
            for (let j = lastOrigIdx; j < originalLines.length; j++) {
              if (originalLines[j].includes(snippet)) {
                actualLine = j + 1;
                lastOrigIdx = j + 1;
                found = true;
                break;
              }
            }
            // Strategy 2: forward search tag name only (collapsed multi-line)
            if (!found) {
              for (let j = lastOrigIdx; j < originalLines.length; j++) {
                if (originalLines[j].includes(tagName)) {
                  actualLine = j + 1;
                  lastOrigIdx = j + 1;
                  found = true;
                  break;
                }
              }
            }
            // Strategy 3: reset to start with full snippet
            if (!found) {
              for (let j = 0; j < originalLines.length; j++) {
                if (originalLines[j].includes(snippet)) {
                  actualLine = j + 1;
                  lastOrigIdx = j + 1;
                  found = true;
                  break;
                }
              }
            }
            // Strategy 4: reset to start with tag name (last resort)
            if (!found) {
              for (let j = 0; j < originalLines.length; j++) {
                if (
                  originalLines[j].includes(tagName) &&
                  !originalLines[j].trim().startsWith("</")
                ) {
                  actualLine = j + 1;
                  lastOrigIdx = j + 1;
                  break;
                }
              }
            }
          }

          const col = match.index + 1;
          const attr = ` data-inspector-line="${actualLine}" data-inspector-column="${col}" data-inspector-relative-path="${relativePath}"`;
          const insertPos = match.index + match[0].length;
          line = line.slice(0, insertPos) + attr + line.slice(insertPos);
          modified = true;
          jsxPattern.lastIndex += attr.length;
          match = jsxPattern.exec(line);
        }
        result.push(line);
      }

      if (!modified) return null;
      return result.join("\n");
    },
  };
}
