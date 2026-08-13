const RISK_LANGUAGE = /\b(risk|risks|could|may|might|depend|failure|fail|adverse|subject to|exposed|unable|uncertain|cyber|security|regulat|litigation|competition|competitive|disruption|volatil|loss|harm|impact|affect)\b/i;
const CONSEQUENCE_LANGUAGE = /\b(could|may|might|would|can|will|depend(?:s|ed)?|fail(?:s|ed)?|harm(?:s|ed)?|affect(?:s|ed)?|impact(?:s|ed)?|result(?:s|ed)?|lead(?:s|ed)? to|limit(?:s|ed)?|reduce(?:s|d)?|increase(?:s|d)?|disrupt(?:s|ed)?|prevent(?:s|ed)?|expos(?:e|es|ed)|threaten(?:s|ed)?|(?:is|are|was|were|be) (?:unable|subject|exposed))\b/i;

export interface ExtractedRiskFactorTheme {
  key: string;
  title: string;
  summary: string;
  evidence: string[];
}

interface SectionDefinition {
  startPattern: RegExp;
  endPattern: RegExp;
}

interface TaxonomyDefinition {
  key: string;
  title: string;
  patterns: Array<{ pattern: RegExp; weight: number }>;
}

interface ClassifiedStatement {
  text: string;
  index: number;
  score: number;
}

const RISK_TAXONOMY: TaxonomyDefinition[] = [
  {
    key: "cybersecurity-data-privacy",
    title: "Cybersecurity and data privacy",
    patterns: [
      { pattern: /\bcyber(?:security|\s*attacks?|\s*incidents?|\s*threats?)?\b/i, weight: 12 },
      { pattern: /\b(data|information) (?:breach|privacy|protection|security)\b/i, weight: 10 },
      { pattern: /\b(ransomware|malware|unauthorized access|security breach)\b/i, weight: 10 },
      { pattern: /\binformation (?:technology|systems?)\b/i, weight: 4 },
    ],
  },
  {
    key: "competition-innovation",
    title: "Competition and innovation",
    patterns: [
      { pattern: /\bcompet(?:e|es|ed|ing|ition|itive|itor|itors)\b/i, weight: 10 },
      { pattern: /\b(market share|pricing pressure|price competition)\b/i, weight: 8 },
      { pattern: /\b(innovation|innovate|technological change|obsolete|obsolescence)\b/i, weight: 7 },
      { pattern: /\b(new products?|product development|changing customer preferences)\b/i, weight: 5 },
    ],
  },
  {
    key: "regulation-legal",
    title: "Regulation and legal exposure",
    patterns: [
      { pattern: /\b(regulation|regulatory|regulated|regulator|compliance)\b/i, weight: 9 },
      { pattern: /\b(laws?|legal proceedings?|litigation|lawsuits?|claims?)\b/i, weight: 7 },
      { pattern: /\b(antitrust|tax laws?|government investigation|government enforcement)\b/i, weight: 8 },
      { pattern: /\b(fines?|penalties|license|licensing requirements?)\b/i, weight: 5 },
    ],
  },
  {
    key: "macroeconomic-demand",
    title: "Macroeconomic conditions and demand",
    patterns: [
      { pattern: /\b(macroeconomic|economic conditions?|recession|economic downturn)\b/i, weight: 10 },
      { pattern: /\b(inflation|interest rates?|consumer spending|customer demand)\b/i, weight: 7 },
      { pattern: /\b(demand|market volatility|currency fluctuations?|foreign exchange)\b/i, weight: 4 },
    ],
  },
  {
    key: "supply-chain-operations",
    title: "Supply chain and operations",
    patterns: [
      { pattern: /\b(supply chain|suppliers?|manufactur(?:e|er|ers|ing)|production)\b/i, weight: 10 },
      { pattern: /\b(logistics|inventory|component shortages?|raw materials?)\b/i, weight: 8 },
      { pattern: /\b(outages?|service failures?|operational disruption|business continuity)\b/i, weight: 7 },
      { pattern: /\b(third[- ]part(?:y|ies)|vendors?|network failures?|capacity constraints?)\b/i, weight: 4 },
    ],
  },
  {
    key: "international-geopolitical",
    title: "International and geopolitical exposure",
    patterns: [
      { pattern: /\b(geopolitical|war|armed conflict|sanctions?)\b/i, weight: 10 },
      { pattern: /\b(tariffs?|trade restrictions?|export controls?|import restrictions?)\b/i, weight: 9 },
      { pattern: /\b(international operations?|foreign markets?|political instability)\b/i, weight: 7 },
      { pattern: /\b(global operations?|outside the united states)\b/i, weight: 4 },
    ],
  },
  {
    key: "financial-liquidity",
    title: "Financial and liquidity risk",
    patterns: [
      { pattern: /\b(liquidity|indebtedness|debt obligations?|credit facilities?)\b/i, weight: 10 },
      { pattern: /\b(cash flows?|financing|capital markets?|credit rating)\b/i, weight: 7 },
      { pattern: /\b(impairment|financial reporting|internal controls?|accounting estimates?)\b/i, weight: 6 },
      { pattern: /\b(stock price|share price|dividend)\b/i, weight: 4 },
    ],
  },
  {
    key: "customers-products-concentration",
    title: "Customer, product and concentration risk",
    patterns: [
      { pattern: /\b(customer concentration|significant customer|major customer|key customer)\b/i, weight: 10 },
      { pattern: /\b(product concentration|limited number of products?|single product)\b/i, weight: 9 },
      { pattern: /\b(product quality|product defects?|product liability|customer retention)\b/i, weight: 7 },
      { pattern: /\b(resellers?|distributors?|sales channels?|installment payment plans?|purchase subsidies)\b/i, weight: 8 },
      { pattern: /\b(depend(?:s|ence|ent)? on (?:a|our) (?:customer|product|platform|distributor))\b/i, weight: 6 },
    ],
  },
  {
    key: "people-execution",
    title: "People and execution",
    patterns: [
      { pattern: /\b(key personnel|senior management|executive officers?|succession)\b/i, weight: 9 },
      { pattern: /\b(employees?|workforce|talent|recruit|retention|labor)\b/i, weight: 6 },
      { pattern: /\b(execute|execution|growth strategy|restructuring)\b/i, weight: 4 },
    ],
  },
  {
    key: "intellectual-property",
    title: "Intellectual property",
    patterns: [
      { pattern: /\bintellectual property\b/i, weight: 11 },
      { pattern: /\b(patents?|trademarks?|copyrights?|trade secrets?)\b/i, weight: 9 },
      { pattern: /\b(proprietary technology|infringement|licensing disputes?)\b/i, weight: 7 },
    ],
  },
  {
    key: "climate-physical-events",
    title: "Climate and physical events",
    patterns: [
      { pattern: /\b(climate change|natural disasters?|extreme weather|severe weather)\b/i, weight: 10 },
      { pattern: /\b(earthquakes?|wildfires?|floods?|hurricanes?|pandemic)\b/i, weight: 8 },
      { pattern: /\b(environmental|physical risks?)\b/i, weight: 5 },
    ],
  },
  {
    key: "transactions-strategy",
    title: "Transactions and strategy",
    patterns: [
      { pattern: /\b(acquisitions?|mergers?|divestitures?|strategic investments?)\b/i, weight: 9 },
      { pattern: /\b(integrat(?:e|es|ed|ing|ion)|joint ventures?)\b/i, weight: 6 },
      { pattern: /\b(goodwill|realize expected benefits|strategic initiatives?)\b/i, weight: 5 },
    ],
  },
];

const EXECUTION_FALLBACK: TaxonomyDefinition = {
  key: "business-performance",
  title: "Business performance and execution",
  patterns: [],
};

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    lsquo: "'",
    mdash: "-",
    ndash: "-",
    nbsp: " ",
    quot: '"',
    rsquo: "'",
  };
  return value
    .replace(/&#(\d+);/g, (entity, code) => {
      const value = Number(code);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    })
    .replace(/&#x([0-9a-f]+);/gi, (entity, code) => {
      const value = Number.parseInt(code, 16);
      return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
    })
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<\s*(?:br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/?(?:address|article|aside|blockquote|caption|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi, "\n")
      // Inline XBRL and styling tags frequently split a single word. Removing
      // those tags without inserting whitespace preserves the filing text.
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r/g, "")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function asGlobal(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

function sectionScore(section: string): number {
  const statements = collectRiskStatements(section);
  const words = section.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0;
  const riskTerms = section.match(/\b(?:risk|could|may|adverse|harm|failure|uncertain|disrupt)\w*\b/gi)?.length ?? 0;
  const density = riskTerms / Math.max(words, 1);
  const tocPenalty = (section.match(/\btable of contents\b/gi)?.length ?? 0) * 500;
  return statements.length * 1_000 + density * 5_000 + Math.min(words, 4_000) * 0.02 - tocPenalty;
}

function findBestSection(text: string, startPattern: RegExp, endPattern: RegExp): string {
  const starts = [...text.matchAll(asGlobal(startPattern))];
  let best = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const start of starts) {
    const afterStart = text.slice((start.index ?? 0) + start[0].length);
    const end = afterStart.match(endPattern);
    const section = (end ? afterStart.slice(0, end.index) : afterStart.slice(0, 250_000)).trim();
    if (section.length < 120) continue;

    const score = sectionScore(section);
    if (score > bestScore || (score === bestScore && section.length > best.length)) {
      best = section;
      bestScore = score;
    }
  }

  return best;
}

function sectionDefinition(form: string): SectionDefinition {
  if (form.startsWith("20-F")) {
    return {
      startPattern: /(?:^|\n)\s*(?:(?:item\s*)?3\s*[.:-]?\s*)?d\s*[.:-]?\s*risk\s+factors?\b/gi,
      endPattern: /(?:^|\n)\s*(?:part\s+i\s*)?item\s*4\b(?:\s*[.:-]|\s|$)/i,
    };
  }

  if (form.startsWith("40-F")) {
    return {
      startPattern: /(?:^|\n)\s*(?:(?:item|section)\s*\d+[a-z]?\s*[.:-]?\s*)?(?:risk\s+factors?|principal\s+risks?\s+and\s+uncertainties)\b/gi,
      endPattern: /(?:^|\n)\s*(?:management(?:'|\u2019)?s\s+discussion(?:\s+and\s+analysis)?|md\s*&\s*a|directors?\s+and\s+officers?|legal\s+proceedings?|dividends?|capital\s+structure|description\s+of\s+capital\s+structure|audit\s+committee|controls?\s+and\s+procedures?|undertakings?|exhibits?|signatures?)\b/i,
    };
  }

  return {
    startPattern: /(?:^|\n)\s*(?:part\s+i\s*)?(?:item\s*)?1\s*a\s*[.:-]?\s*risk\s+factors?\b/gi,
    endPattern: /(?:^|\n)\s*(?:part\s+i{1,3}\s*)?item\s*(?:1\s*[bc]|2)\b(?:\s*[.:-]|\s|$)/i,
  };
}

function riskSection(text: string, form: string): string {
  const definition = sectionDefinition(form);
  return findBestSection(text, definition.startPattern, definition.endPattern);
}

function cleanCandidate(value: string): string {
  return value
    .replace(/^[\s\-\u2013\u2014*\u2022\u00b7\u25aa\u25e6\d.()]+/u, "")
    .replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isBoilerplate(value: string): boolean {
  return /summary of (?:the )?risk factors|read this summary together with|the following (?:is|are) (?:a )?summary|for a discussion of|see (?:the )?section|incorporated (?:herein )?by reference/i.test(value)
    || /^the following summarizes factors that could\b/i.test(value)
    || /^(?:item\s+[\w.]+|risk factors?|table of contents|page\s+\d+)\b/i.test(value)
    || /^(?:we face|the following|our business is subject to)\s+(?:the following\s+)?risks?[:.]?$/i.test(value)
    || /^statements in this section (?:reflect|are based on)\b/i.test(value)
    || /^you should carefully consider\b.*\brisks? described\b/i.test(value)
    || /\b(?:predict|control|mitigate) these risks\b/i.test(value)
    || /^risks and uncertainties not currently known\b/i.test(value)
    || /^adverse (?:global|regional|global or regional|business) conditions could harm (?:our|the company(?:'s)?) business[.!]?$/i.test(value);
}

function normalizeStatement(value: string): string | null {
  const cleaned = cleanCandidate(value);
  if (cleaned.length < 45 || cleaned.length > 320) return null;
  if (!RISK_LANGUAGE.test(cleaned) || !CONSEQUENCE_LANGUAGE.test(cleaned)) return null;
  if (isBoilerplate(cleaned)) return null;

  const wordCount = cleaned.split(/\s+/).length;
  if (wordCount < 8 || wordCount > 55) return null;
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function statementParts(value: string): string[] {
  const line = cleanCandidate(value);
  if (!line) return [];
  return line.split(/(?<=[.!?])\s+(?=["\u201c']?[A-Z0-9])/).map((part) => part.trim()).filter(Boolean);
}

function dedupeStatements(values: string[], limit = Number.POSITIVE_INFINITY): string[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prefix = key.slice(0, 110);
    if (!prefix || seen.has(key) || [...seen].some((existing) => existing.slice(0, 110) === prefix)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }

  return output;
}

function collectRiskStatements(section: string): string[] {
  const candidates = section
    .split(/\n+/)
    .flatMap(statementParts)
    .map(normalizeStatement)
    .filter((value): value is string => Boolean(value));

  return dedupeStatements(candidates);
}

function taxonomyScore(statement: string, taxonomy: TaxonomyDefinition): number {
  return taxonomy.patterns.reduce(
    (score, entry) => score + (entry.pattern.test(statement) ? entry.weight : 0),
    0,
  );
}

function classifyStatement(statement: string): { taxonomy: TaxonomyDefinition; score: number } {
  let best = EXECUTION_FALLBACK;
  let bestScore = 1;

  for (const taxonomy of RISK_TAXONOMY) {
    const score = taxonomyScore(statement, taxonomy);
    if (score > bestScore) {
      best = taxonomy;
      bestScore = score;
    }
  }

  return { taxonomy: best, score: bestScore };
}

function neutralizePerspective(value: string): string {
  return value
    .replace(/[.!?]+$/, "")
    .replace(/\bwe are\b/gi, "the company is")
    .replace(/\bwe were\b/gi, "the company was")
    .replace(/\bwe have\b/gi, "the company has")
    .replace(/\bwe do\b/gi, "the company does")
    .replace(/\bwe (depend|rely|face|operate|derive|use|maintain|need|expect|believe|experience|serve|sell|offer|provide|generate|conduct|compete)\b/gi, (_, verb: string) => {
      const lower = verb.toLowerCase();
      const inflected = lower.endsWith("y")
        ? `${lower.slice(0, -1)}ies`
        : /(?:s|x|z|ch|sh|o)$/.test(lower)
          ? `${lower}es`
          : `${lower}s`;
      return `the company ${inflected}`;
    })
    .replace(/\bwe\b/gi, "the company")
    .replace(/\bour\b/gi, "its")
    .replace(/\bus\b/gi, "the company")
    .replace(/\bours\b/gi, "its")
    .replace(/\bthe company (are|have|seek|depend|face|operate|plan|expect|rely|believe|do)\b/gi, (_, verb: string) => {
      const inflections: Record<string, string> = {
        are: "is",
        have: "has",
        seek: "seeks",
        depend: "depends",
        face: "faces",
        operate: "operates",
        plan: "plans",
        expect: "expects",
        rely: "relies",
        believe: "believes",
        do: "does",
      };
      return `the company ${inflections[verb.toLowerCase()] ?? verb}`;
    });
}

function lowerInitial(value: string): string {
  if (!/^[A-Z][a-z]/.test(value)) return value;
  return `${value[0].toLowerCase()}${value.slice(1)}`;
}

function summaryFromEvidence(evidence: string): string {
  const statement = lowerInitial(neutralizePerspective(evidence));
  return `The filing reports that ${statement}.`;
}

export function extractRiskFactorHeadings(html: string, form: string, limit = 8): string[] {
  if (limit <= 0) return [];
  const text = htmlToText(html);
  const section = riskSection(text, form.toUpperCase());
  if (!section) return [];
  return collectRiskStatements(section).slice(0, limit);
}

export function extractRiskFactorThemes(html: string, form: string, limit = 8): ExtractedRiskFactorTheme[] {
  const safeLimit = Math.max(0, Math.min(8, Math.floor(limit)));
  if (safeLimit === 0) return [];

  const text = htmlToText(html);
  const section = riskSection(text, form.toUpperCase());
  if (!section) return [];

  const statements = collectRiskStatements(section);
  const buckets = new Map<string, { taxonomy: TaxonomyDefinition; statements: ClassifiedStatement[] }>();

  statements.forEach((statement, index) => {
    const { taxonomy, score } = classifyStatement(statement);
    if (taxonomy.key === EXECUTION_FALLBACK.key) return;
    const bucket = buckets.get(taxonomy.key) ?? { taxonomy, statements: [] };
    bucket.statements.push({ text: statement, index, score });
    buckets.set(taxonomy.key, bucket);
  });

  const selected = [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      firstIndex: Math.min(...bucket.statements.map((statement) => statement.index)),
      strength: bucket.statements.reduce((score, statement) => score + statement.score, 0) + bucket.statements.length * 2,
    }))
    .sort((left, right) => right.strength - left.strength || left.firstIndex - right.firstIndex || left.taxonomy.key.localeCompare(right.taxonomy.key))
    .slice(0, safeLimit)
    .sort((left, right) => left.firstIndex - right.firstIndex);

  return selected.map((bucket) => {
    const evidence = [...bucket.statements]
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 2)
      .sort((left, right) => left.index - right.index)
      .map((statement) => statement.text);

    return {
      key: bucket.taxonomy.key,
      title: bucket.taxonomy.title,
      summary: summaryFromEvidence(evidence[0]),
      evidence,
    };
  });
}
