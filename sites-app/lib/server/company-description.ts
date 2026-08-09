const DETAIL_SIGNALS: Array<[RegExp, number]> = [
  [/\b(?:products?|services?|solutions?|vehicles?|brands?) include\b/i, 10],
  [/\b(?:creates?|designs?|develops?|makes?|making|manufactures?|sells?|provides?|offers?|operates?|distributes?)\b/i, 6],
  [/\b(?:delivers?|supports?|serves?|used by)\b/i, 5],
  [/\b(?:workloads?|applications?)\b/i, 4],
  [/\b(?:customers?|enterprises?|consumers?|businesses|governments?|data centers?|public clouds?)\b/i, 3],
];

const GENERIC_SIGNALS: Array<[RegExp, number]> = [
  [/\b(?:leading|world-class|unique|powerful|differentiated|ever-expanding)\b/i, -3],
  [/\b(?:innovation|innovative|mission|committed|empower|prosper|potential)\b/i, -4],
  [/\b(?:years? of|founded|head office|headquarters)\b/i, -3],
  [/\b(?:plans? to|expects? to|will begin|intends? to)\b/i, -8],
  [/\b(?:revenues?|fiscal year|employees?)\b/i, -4],
];

function cleanDescription(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/([.!?])(?=[A-Z])/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function possessive(companyName: string) {
  return /s$/i.test(companyName) ? `${companyName}'` : `${companyName}'s`;
}

function neutralizeSentence(sentence: string, companyName: string | undefined, fullDescription: string) {
  let result = sentence
    .replace(/^With a differentiated innovation engine driving advancements in [^,]+,\s*/i, "")
    .replace(/\b(?:a )?broad and ever-expanding\b/gi, "")
    .replace(/\ba broad range of\b/gi, "")
    .replace(/\bpowerful\b/gi, "")
    .replace(/\binnovative\b/gi, "")
    .replace(/\bsolid state\b/gi, "solid-state")
    .replace(/\buniversal serial bus\b/gi, "USB")
    .replace(/\bartificial intelligence\b/gi, "AI")
    .replace(/\bdatacenters\b/gi, "data centers")
    .replace(/\s+,/g, ",")
    .replace(/\s*\(Nasdaq[^)]*\)/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (companyName) {
    const companyPossessive = possessive(companyName);
    const singularVerbs: Record<string, string> = {
      create: "creates",
      deliver: "delivers",
      design: "designs",
      develop: "develops",
      distribute: "distributes",
      manufacture: "manufactures",
      offer: "offers",
      operate: "operates",
      provide: "provides",
      sell: "sells",
      support: "supports",
    };
    result = result
      .replace(/^Our (?=(?:products?|services?|solutions?)\b)/i, `${companyPossessive} `)
      .replace(/^Our\b/i, "Its")
      .replace(/^We are\b/i, `${companyName} is`)
      .replace(/^We (create|deliver|design|develop|distribute|manufacture|offer|operate|provide|sell|support)\b/i, (_, verb: string) => `${companyName} ${singularVerbs[verb.toLowerCase()]}`)
      .replace(/^We\b/i, companyName)
      .replace(/^our\b/i, "Its")
      .replace(/\bour\b/gi, "its")
      .replace(/\bwe\b/gi, companyName)
      .replace(/\bus\b/gi, companyName);
  }

  if (/\bsemiconductor\b/i.test(fullDescription)) {
    result = result.replace(/\bwafers and components\b/i, "semiconductor wafers and components");
  }

  result = result
    .replace(/^Its (?:portfolio|product portfolio) delivers flash storage (?:solutions|products) for\b/i, "Its flash storage products support")
    .replace(/\bflash storage solutions\b/gi, "flash storage products")
    .replace(/\s+/g, " ")
    .trim();

  return result.endsWith(".") ? result : `${result.replace(/[,:;.!?]+$/g, "")}.`;
}

function sentenceScore(sentence: string) {
  if (/\b(?:learn more|visit us|www\.|https?:\/\/)\b/i.test(sentence)) return -100;
  let score = Math.min((sentence.match(/,/g) ?? []).length, 3);
  for (const [pattern, weight] of DETAIL_SIGNALS) if (pattern.test(sentence)) score += weight;
  for (const [pattern, weight] of GENERIC_SIGNALS) if (pattern.test(sentence)) score += weight;
  return score;
}

function clipSummary(summary: string, maxLength: number) {
  if (summary.length <= maxLength) return summary;
  const clipped = summary.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const cutAt = lastSpace >= Math.floor(maxLength * 0.7) ? lastSpace : maxLength;
  return `${clipped.slice(0, cutAt).replace(/[,:;.!?]+$/g, "").trim()}.`;
}

export function summarizeCompanyDescription(value: string, companyName?: string, maxLength = 420) {
  const cleaned = cleanDescription(value);
  if (!cleaned) return null;

  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(cleaned)]
    .map(({ segment }, index) => ({ segment: segment.trim(), index }))
    .filter(({ segment }) => Boolean(segment));
  const useful = sentences
    .map((sentence) => ({
      ...sentence,
      score: sentenceScore(neutralizeSentence(sentence.segment, companyName, cleaned)),
    }))
    .filter(({ score }) => score >= 4)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 2);
  const selected = useful.length ? useful : sentences.slice(0, 2);
  selected.sort((left, right) => {
    const leftListsOfferings = /\b(?:products?|services?|solutions?|vehicles?|brands?) include\b/i.test(left.segment);
    const rightListsOfferings = /\b(?:products?|services?|solutions?|vehicles?|brands?) include\b/i.test(right.segment);
    if (leftListsOfferings !== rightListsOfferings) return leftListsOfferings ? -1 : 1;
    return left.index - right.index;
  });
  const summary = selected
    .map(({ segment }) => neutralizeSentence(segment, companyName, cleaned))
    .join(" ");

  return clipSummary(summary, maxLength);
}
