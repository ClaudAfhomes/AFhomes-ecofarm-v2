/** `bank_transfer` -> `Bank transfer`. Display only. */
export function sentenceCase(value: string): string {
  const text = value.replaceAll('_', ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
