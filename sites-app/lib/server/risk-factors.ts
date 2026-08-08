const RISK_LANGUAGE = /\b(risk|risks|could|may|might|depend|failure|fail|adverse|subject to|exposed|unable|uncertain|cyber|security|regulat|litigation|competition|competitive|disruption|volatil|loss|harm|impact|affect)\b/i;

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(?:div|p|li|h[1-6]|tr|table|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findLongestSection(text: string, startPattern: RegExp, endPattern: RegExp): string {
  const startFlags = startPattern.flags.includes("g") ? startPattern.flags : `${startPattern.flags}g`;
  const starts = [...text.matchAll(new RegExp(startPattern.source, startFlags))];
  let best = "";

  for (const start of starts) {
    const afterStart = text.slice((start.index ?? 0) + start[0].length);
    const end = afterStart.match(endPattern);
    const section = end ? afterStart.slice(0, end.index) : afterStart.slice(0, 250_000);
    if (section.length > best.length && section.length >= 150) best = section;
  }

  return best;
}

function riskSection(text: string, form: string): string {
  if (form === "20-F") {
    return findLongestSection(
      text,
      /(?:^|\n)\s*(?:item\s+3[.:\s-]*)?d[.:\s-]+risk factors\b/gi,
      /(?:^|\n)\s*item\s+4\b/i,
    );
  }

  if (form === "40-F") {
    return findLongestSection(
      text,
      /(?:^|\n)\s*(?:risk factors|principal risks and uncertainties)\b/gi,
      /(?:^|\n)\s*(?:management'?s discussion|item\s+4|directors and officers)\b/i,
    );
  }

  return findLongestSection(
    text,
    /(?:^|\n)\s*item\s+1a[.:\s-]*risk factors\b/gi,
    /(?:^|\n)\s*item\s+(?:1b|2)[.:\s-]/i,
  );
}

function cleanCandidate(value: string): string {
  return value
    .replace(/^[-*•\d.()\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isCandidate(value: string): boolean {
  if (value.length < 35 || value.length > 280) return false;
  if (!RISK_LANGUAGE.test(value)) return false;
  if (!/[.;!?]$/.test(value)) return false;
  if (/summary of (?:the )?risk factors|read this summary together with/i.test(value)) return false;
  if (/^(?:item\s+\w+|risk factors?|table of contents|page\s+\d+)\b/i.test(value)) return false;
  if (/^(?:we face|the following|our business is subject to)\s+(?:the following\s+)?risks?[:.]?$/i.test(value)) return false;
  const wordCount = value.split(/\s+/).length;
  return wordCount >= 6 && wordCount <= 44;
}

function dedupeCandidates(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 96);
    if (!key || [...seen].some((existing) => existing.startsWith(key.slice(0, 55)) || key.startsWith(existing.slice(0, 55)))) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }

  return output;
}

export function extractRiskFactorHeadings(html: string, form: string, limit = 8): string[] {
  const text = htmlToText(html);
  const section = riskSection(text, form.toUpperCase());
  if (!section) return [];

  const lineCandidates = section
    .split(/\n+/)
    .map(cleanCandidate)
    .filter(isCandidate);
  const fromLines = dedupeCandidates(lineCandidates, limit);
  if (fromLines.length >= Math.min(4, limit)) return fromLines;

  const sentenceCandidates = section
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(cleanCandidate)
    .filter(isCandidate);

  return dedupeCandidates([...fromLines, ...sentenceCandidates], limit);
}
