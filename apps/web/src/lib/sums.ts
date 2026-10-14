/** One way of printing a figure in $ millions: the text, and the signed value that text stands for. */
export interface Printer {
  text: (musd: number, extra: number) => string;
  value: (musd: number, extra: number) => number;
}

/** The most decimals added to a figure: past this the digits mean nothing to a reader. */
const MOST_EXTRA = 1;

/**
 * How many extra decimals a sentence needs before the numbers it prints add up: the least `extra` (0 to 1) for which
 * `holds` is true, else the most; the sentence then derives its total from the parts it shows. It reads figures back as printed (`v`) and compares a sum of those with a true total as that total
 * prints (`eq`), so "$101B and $141B make $241B" is caught and "$100.7B and $140.6B make $241.3B" is not.
 */
export function extraDigits(
  p: Printer,
  holds: (v: (musd: number) => number, eq: (printedSum: number, total: number) => boolean) => boolean,
): number {
  for (let extra = 0; extra < MOST_EXTRA; extra++)
    if (
      holds(
        (m) => p.value(m, extra),
        (sum, total) => p.text(sum, extra) === p.text(total, extra),
      )
    )
      return extra;
  return MOST_EXTRA;
}
