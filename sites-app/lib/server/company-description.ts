export function summarizeCompanyDescription(value: string, maxLength = 420) {
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(cleaned)]
    .map(({ segment }) => segment.trim())
    .filter(Boolean);
  const summary = sentences.slice(0, 2).join(" ");
  if (summary.length <= maxLength) return summary;

  const clipped = summary.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const cutAt = lastSpace >= Math.floor(maxLength * 0.7) ? lastSpace : maxLength;
  return `${clipped.slice(0, cutAt).replace(/[,:;.!?]+$/g, "").trim()}.`;
}
