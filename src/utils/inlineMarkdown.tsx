/**
 * Markdown léger partagé avec le site (Lore, patch notes) : **gras**, *italique*, [TITLE]…[/TITLE].
 */
import type { ReactNode } from "react";

export type InlineMarkdownOptions = {
  titleClassName?: string;
};

export function renderInlineMarkdown(
  text: string,
  options: InlineMarkdownOptions = {},
): ReactNode {
  const { titleClassName = "lore-story-section-title" } = options;
  if (!text || typeof text !== "string") return text;
  let k = 0;

  function parseBold(str: string): ReactNode[] {
    const out: ReactNode[] = [];
    let rest = str;
    while (rest) {
      const a = rest.indexOf("**");
      if (a === -1) {
        out.push(...parseItalic(rest));
        break;
      }
      const b = rest.indexOf("**", a + 2);
      if (b === -1) {
        out.push(...parseItalic(rest));
        break;
      }
      if (a > 0) out.push(...parseItalic(rest.slice(0, a)));
      out.push(<strong key={`b${k++}`}>{parseItalic(rest.slice(a + 2, b))}</strong>);
      rest = rest.slice(b + 2);
    }
    return out;
  }

  function parseItalic(str: string): ReactNode[] {
    const out: ReactNode[] = [];
    let rest = str;
    while (rest) {
      const a = rest.indexOf("*");
      if (a === -1) {
        if (rest) out.push(rest);
        break;
      }
      const b = rest.indexOf("*", a + 1);
      if (b === -1) {
        out.push(rest);
        break;
      }
      if (a > 0) out.push(rest.slice(0, a));
      out.push(<em key={`i${k++}`}>{rest.slice(a + 1, b)}</em>);
      rest = rest.slice(b + 1);
    }
    return out;
  }

  function parseTitle(str: string): ReactNode[] {
    const out: ReactNode[] = [];
    let rest = str;
    const openTag = "[TITLE]";
    const closeTag = "[/TITLE]";
    while (rest) {
      const a = rest.indexOf(openTag);
      if (a === -1) {
        out.push(...parseBold(rest));
        break;
      }
      const b = rest.indexOf(closeTag, a + openTag.length);
      if (b === -1) {
        out.push(...parseBold(rest));
        break;
      }
      if (a > 0) out.push(...parseBold(rest.slice(0, a)));
      out.push(
        <span key={`t${k++}`} className={titleClassName}>
          {parseBold(rest.slice(a + openTag.length, b))}
        </span>,
      );
      rest = rest.slice(b + closeTag.length);
    }
    return out;
  }

  const parts = parseTitle(text);
  return parts.length ? parts : text;
}
