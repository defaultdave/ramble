/** The text with its ends trimmed, or null when nothing is left. */
export function presentText(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
}

/** One entry per non-blank line, so a description written in paragraphs or a list keeps its shape. */
export function textLines(value: string | null): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
