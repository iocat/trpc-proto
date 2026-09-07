export function dedent(text: string): string {
  const lines = text.replace(/^\n/, '').split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0);
  const n = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(n)).join('\n');
}
