const currencyFormatters = new Map<number, Intl.NumberFormat>();
const compactCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function currencyFormatter(digits: number): Intl.NumberFormat {
  const normalizedDigits = Math.max(0, Math.min(20, Math.trunc(digits)));
  const cached = currencyFormatters.get(normalizedDigits);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: normalizedDigits,
    maximumFractionDigits: normalizedDigits,
  });
  currencyFormatters.set(normalizedDigits, formatter);
  return formatter;
}

export function money(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return currencyFormatter(digits).format(value);
}

export function compactMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return compactCurrencyFormatter.format(value);
}

export function compactShares(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${compactNumberFormatter.format(value)} shares`;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

export function multiple(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}x`;
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
