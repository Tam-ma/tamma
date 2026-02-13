const noColor = Boolean(process.env['NO_COLOR']);

/**
 * Returns a spread-friendly object for Ink `<Text>` color props.
 * Usage: `<Text {...colorProp('cyan')}>text</Text>`
 *
 * When NO_COLOR is set, returns `{}` (no color applied).
 * Otherwise, returns `{ color: c }`.
 */
export function colorProp(c: string): { color: string } | object {
  return noColor ? {} : { color: c };
}
