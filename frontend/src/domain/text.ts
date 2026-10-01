/** "rolled_back" → "Rolled Back": readable manager identifiers. */
export function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

/** A user-facing message for anything a binding or manager call throws. */
export function explain(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The manager did not complete that request.";
}

/** "1 key", "3 keys". */
export function count(
  amount: number,
  singular: string,
  plural = `${singular}s`,
) {
  return `${amount} ${amount === 1 ? singular : plural}`;
}
