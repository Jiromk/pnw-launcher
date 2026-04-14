/** Ligne de liste : espaces optionnels, - ou *, puis texte. */
export const PATCH_LIST_LINE_PATTERN = /^(\s*)([-*])\s+(.*)$/;

/** Ligne qui continue la puce précédente (indentée, sans nouveau tiret). */
export function isContinuationLine(line: string): boolean {
  if (!line || PATCH_LIST_LINE_PATTERN.test(line)) return false;
  return /^\s{2,}\S/.test(line);
}

function mergeListContinuation(lastLine: string, contLine: string): string {
  const m = lastLine.match(PATCH_LIST_LINE_PATTERN);
  if (!m) return `${lastLine}\n${contLine}`;
  const tail = contLine.replace(/^\s+/, "").trimEnd();
  return `${m[1]}${m[2]} ${m[3]}\n${tail}`;
}

export interface PatchSegment {
  type: "list" | "plain";
  lines: string[];
}

export function splitPatchMarkdownSegments(text: string): PatchSegment[] {
  const lines = String(text ?? "").split("\n");
  const segments: PatchSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    if (PATCH_LIST_LINE_PATTERN.test(lines[i])) {
      const listLines: string[] = [];
      while (i < lines.length && PATCH_LIST_LINE_PATTERN.test(lines[i])) {
        let row = lines[i];
        i++;
        while (i < lines.length && isContinuationLine(lines[i])) {
          row = mergeListContinuation(row, lines[i]);
          i++;
        }
        listLines.push(row);
      }
      segments.push({ type: "list", lines: listLines });
    } else {
      const plainLines: string[] = [];
      while (i < lines.length && !PATCH_LIST_LINE_PATTERN.test(lines[i])) {
        plainLines.push(lines[i]);
        i++;
      }
      segments.push({ type: "plain", lines: plainLines });
    }
  }
  return segments;
}

export interface ParsedListItem {
  level: number;
  text: string;
}

export function parseListLinesToLevels(lines: string[]): ParsedListItem[] {
  const parsed: ParsedListItem[] = [];
  for (const row of lines) {
    const parts = row.split("\n");
    const m = parts[0].match(PATCH_LIST_LINE_PATTERN);
    if (!m) continue;
    const textBody =
      parts.length > 1 ? [m[3], ...parts.slice(1)].join("\n").trimEnd() : m[3];
    const indent = m[1].length;
    const level = Math.floor(indent / 2);
    parsed.push({ level, text: textBody });
  }
  return parsed;
}

export interface ListTreeNode {
  text: string;
  children: ListTreeNode[];
}

/** Arbre { text, children }[] pour <ul>/<li> imbriqués. */
export function nestListItems(parsed: ParsedListItem[]): ListTreeNode[] {
  const root: ListTreeNode[] = [];
  const stack: { level: number; arr: ListTreeNode[] }[] = [{ level: -1, arr: root }];
  for (const { level, text } of parsed) {
    const node: ListTreeNode = { text, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    parent.arr.push(node);
    stack.push({ level, arr: node.children });
  }
  return root;
}
