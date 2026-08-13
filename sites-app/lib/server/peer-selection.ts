export const PEER_SELECTION_VERSION = "peer-selection-3.0";
export const NASDAQ_PEER_SOURCE_LABEL = "Nasdaq Stock Screener and company profiles";
export const NASDAQ_PEER_SOURCE_URL = "https://www.nasdaq.com/market-activity/stocks/screener";
export const MIN_AUTOMATIC_PEER_SCORE = 42;
const MAX_AUTOMATIC_SIZE_RATIO = 250;

export type PeerCandidateInput = {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  description?: string | null;
  reviewedReason?: string | null;
  evidenceLabel?: string | null;
  evidenceUrl?: string | null;
};

export type PeerTargetInput = {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  description?: string | null;
  primaryDescription?: string | null;
};

export type RankedPeerCandidate = PeerCandidateInput & {
  selectionScore: number;
  selectionReason: string;
  selectionFactors: string[];
  sourceLabel: string;
  sourceUrl: string;
};

const STOP_WORDS = new Set([
  "and", "the", "for", "with", "that", "from", "into", "its", "our", "their", "company",
  "companies", "business", "businesses", "products", "product", "services", "service", "solutions",
  "provides", "offers", "including", "through", "across", "customers", "market", "markets", "global",
  "leading", "technology", "technologies", "based", "other", "also", "which", "such", "more", "using",
  "industry", "industries", "corporation", "incorporated", "limited",
  "develops", "designs", "manufactures", "sells", "operates", "provider", "platform", "platforms",
  "software", "tools", "empowers", "everyone", "helping", "helps", "enables", "enable",
  "experiences", "productivity", "innovation", "innovative", "leader", "information", "world", "visit",
]);

const BUSINESS_FACETS = [
  { label: "PCs, workstations and client devices", keywords: ["personal computer", "desktop computer", "notebook computer", "laptop", "workstation", "client device", "computer peripheral"] },
  { label: "enterprise servers and data-center infrastructure", keywords: ["server", "data center", "datacenter", "infrastructure", "enterprise hardware", "high performance computing", "supercomput"] },
  { label: "storage and data infrastructure", keywords: ["storage", "solid state", "ssd", "flash memory", "data infrastructure"] },
  { label: "networking products", keywords: ["networking", "network equipment", "router", "switching", "connectivity infrastructure"] },
  { label: "semiconductor products", keywords: ["semiconductor", "processor", "chip", "integrated circuit", "gpu", "microprocessor"] },
  { label: "enterprise software and subscriptions", keywords: ["enterprise software", "software subscription", "subscription software", "software-as-a-service", "saas", "cloud software", "database software", "enterprise application"] },
  { label: "workplace productivity software", keywords: ["productivity software", "productivity application", "office productivity", "collaboration software", "workplace software"] },
  { label: "creative, design and digital-content tools", keywords: ["creative software", "creative tools", "creativity", "creative professional", "creator", "design platform", "design software", "digital media", "content creation", "imaging", "video editing", "3d design"] },
  { label: "document workflows and electronic signatures", keywords: ["pdf", "document cloud", "document workflow", "document management", "electronic signature", "e-signature", "digital signature", "agreement cloud", "agreement management"] },
  { label: "engineering and product-design software", keywords: ["computer aided design", "cad software", "engineering design", "electronic design", "design automation", "architecture engineering", "digital twin"] },
  { label: "customer-experience and marketing software", keywords: ["customer experience", "digital experience", "experience management", "marketing automation", "content management", "personalized experience"] },
  { label: "enterprise workflow and CRM applications", keywords: ["customer relationship management", "crm software", "enterprise application", "workflow automation", "digital workflow", "business workflow"] },
  { label: "financial and commerce software", keywords: ["financial technology", "fintech", "accounting software", "tax software", "commerce platform", "point of sale", "seller ecosystem"] },
  { label: "data, analytics and AI platforms", keywords: ["data cloud", "data warehouse", "data analytics", "analytics platform", "artificial intelligence platform", "machine learning platform"] },
  { label: "network security and connectivity cloud", keywords: ["connectivity cloud", "network security", "cybersecurity", "content delivery network", "zero trust", "web security"] },
  { label: "cloud-computing customers", keywords: ["cloud computing", "public cloud", "cloud provider", "cloud services", "hyperscale"] },
  { label: "digital advertising platforms", keywords: ["digital advertising", "online advertising", "advertiser", "ad platform", "advertising revenue"] },
  { label: "payment networks and merchant services", keywords: ["payment network", "payment processing", "merchant", "cardholder", "credit card", "digital payment", "transaction processing"] },
  { label: "consumer and commercial banking", keywords: ["consumer banking", "commercial banking", "deposits", "lending", "banking services", "credit services"] },
  { label: "footwear and apparel brands", keywords: ["footwear", "shoe", "athletic apparel", "casual footwear", "performance footwear"] },
  { label: "membership and large-format retail", keywords: ["membership warehouse", "warehouse club", "discount store", "general merchandise"] },
  { label: "store and e-commerce distribution", keywords: ["retail stores", "direct to consumer", "e-commerce", "online retail", "wholesale customers"] },
  { label: "restaurants and franchising", keywords: ["restaurant", "franchise", "quick service", "foodservice"] },
  { label: "beverages and consumer brands", keywords: ["beverage", "soft drink", "snack", "consumer packaged", "bottling"] },
  { label: "automotive manufacturing", keywords: ["automotive", "vehicle", "electric vehicle", "automobile", "car manufacturer"] },
  { label: "streaming and media subscribers", keywords: ["streaming", "subscriber", "television", "film studio", "entertainment content", "media network"] },
  { label: "e-commerce customers", keywords: ["e-commerce", "online marketplace", "online retail", "digital commerce"] },
  { label: "biotechnology and life-science customers", keywords: ["biotechnology", "biopharmaceutical", "clinical", "therapeutic", "life science", "medical device"] },
] as const;

const BROAD_INDUSTRY_PATTERNS = [
  "computer software prepackaged software",
  "computer peripheral equipment",
  "business services",
  "diversified commercial services",
  "industrial specialties",
  "miscellaneous",
] as const;

const DISTINCT_BUSINESS_DOMAINS = [
  { label: "video-game publishing", keywords: ["video game publisher", "game publisher", "mobile games", "console games", "interactive entertainment"] },
  { label: "semiconductor design", keywords: ["silicon design", "electronic design automation", "semiconductor design", "chip design"] },
  { label: "network security", keywords: ["connectivity cloud", "network security", "cybersecurity", "content delivery network", "zero trust"] },
  { label: "financial technology", keywords: ["financial technology", "fintech", "merchant payments", "point of sale", "seller ecosystem"] },
  { label: "data cloud", keywords: ["data cloud", "data warehouse", "cloud data platform"] },
  { label: "communications APIs", keywords: ["communications api", "cloud communications", "messaging api", "customer engagement platform"] },
] as const;

function normalized(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function decodedText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/\s+/g, " ")
    .trim();
}

export function extractPeerBusinessContext(html: string) {
  const text = decodedText(html);
  const businessHeading = /\bITEM\s+1\.?\s+BUSINESS\b/gi;
  let best = "";
  for (const match of text.matchAll(businessHeading)) {
    const candidate = text.slice(match.index, Math.min((match.index ?? 0) + 50_000, text.length));
    const stop = candidate.slice(100).search(/\b(COMPETITION|ITEM 1A\.?|RISK FACTORS|HUMAN CAPITAL|PROPERTIES)\b/i);
    const section = candidate.slice(0, stop >= 0 ? stop + 100 : undefined);
    if (section.length < 200 || !/\b(our|we|company|solutions|products|customers)\b/i.test(section)) continue;
    if (section.length > best.length) best = section;
  }
  if (best) return best.slice(0, 36_000);

  const competitionHeading = /\bCOMPETITION\b/g;
  for (const match of text.matchAll(competitionHeading)) {
    const candidate = text.slice(match.index, Math.min((match.index ?? 0) + 24_000, text.length));
    if (!/\b(we compete|our solutions|competitors include|competitive environment)\b/i.test(candidate.slice(0, 3_000))) continue;
    const stop = candidate.search(/\b(ITEM 1A\.?|RISK FACTORS|HUMAN CAPITAL|PROPERTIES)\b/i);
    const section = candidate.slice(0, stop > 0 ? stop : undefined);
    if (section.length < 120) continue;
    if (section.length > best.length) best = section;
  }
  return best.slice(0, 24_000);
}

function words(value: string | null | undefined) {
  return normalized(value)
    .split(" ")
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

function sharedFacets(target: PeerTargetInput, candidate: PeerCandidateInput) {
  const targetText = ` ${normalized(target.description)} `;
  const candidateText = ` ${normalized(candidate.description)} `;
  return BUSINESS_FACETS
    .filter((facet) => facet.keywords.some((keyword) => targetText.includes(normalized(keyword)))
      && facet.keywords.some((keyword) => candidateText.includes(normalized(keyword))))
    .map((facet) => facet.label);
}

function businessDomains(value: string | null | undefined) {
  const text = ` ${normalized(value)} `;
  return DISTINCT_BUSINESS_DOMAINS
    .filter((domain) => domain.keywords.some((keyword) => text.includes(normalized(keyword))))
    .map((domain) => domain.label);
}

function industryScore(targetIndustry: string | null, candidateIndustry: string | null) {
  const target = normalized(targetIndustry);
  const candidate = normalized(candidateIndustry);
  if (!target || !candidate) return { score: 0, exact: false, related: false };
  if (target === candidate) return { score: 60, exact: true, related: true };
  const targetWords = new Set(words(target));
  const overlap = words(candidate).filter((word) => targetWords.has(word));
  return { score: Math.min(overlap.length * 12, 36), exact: false, related: overlap.length > 0 };
}

function sizeScore(targetCap: number | null, candidateCap: number | null) {
  if (!targetCap || !candidateCap || targetCap <= 0 || candidateCap <= 0) return 0;
  const distance = Math.abs(Math.log(candidateCap / targetCap));
  return Math.max(0, 10 * (1 - distance / Math.log(100)));
}

function sizeRatio(targetCap: number | null, candidateCap: number | null) {
  if (!targetCap || !candidateCap || targetCap <= 0 || candidateCap <= 0) return null;
  return Math.max(targetCap, candidateCap) / Math.min(targetCap, candidateCap);
}

function reasonFor(
  target: PeerTargetInput,
  candidate: PeerCandidateInput,
  exactIndustry: boolean,
  relatedIndustry: boolean,
  facets: string[],
  commonTerms: string[],
) {
  if (candidate.reviewedReason) return candidate.reviewedReason;
  const details: string[] = [];
  if (exactIndustry && target.industry) details.push(`both are classified by Nasdaq in ${target.industry}`);
  else if (relatedIndustry) details.push("their Nasdaq industries are closely related");
  else if (normalized(target.sector) && normalized(target.sector) === normalized(candidate.sector)) details.push(`both operate in the ${target.sector} sector`);
  if (facets.length) details.push(`they overlap in ${facets.slice(0, 2).join(" and ")}`);
  else if (commonTerms.length) details.push(`their company profiles share a focus on ${commonTerms.slice(0, 3).join(", ")}`);
  if (!details.length) details.push("it is the closest available operating match by industry and company size");
  return `Selected because ${details.join("; ")}.`;
}

export function rankPeerCandidates(target: PeerTargetInput, candidates: PeerCandidateInput[]) {
  const targetTokens = new Set(words(`${target.industry ?? ""} ${target.description ?? ""}`));
  const targetHasBroadIndustry = BROAD_INDUSTRY_PATTERNS.some((pattern) => normalized(target.industry).includes(pattern));
  const targetPrimaryDomains = new Set(businessDomains(target.primaryDescription ?? target.description));
  return candidates
    .filter((candidate) => candidate.ticker !== target.ticker && candidate.marketCap !== 0)
    .map((candidate): RankedPeerCandidate => {
      const industry = industryScore(target.industry, candidate.industry);
      const sameSector = normalized(target.sector) && normalized(target.sector) === normalized(candidate.sector);
      const facets = sharedFacets(target, candidate);
      const commonTerms = [...new Set(words(candidate.description).filter((word) => targetTokens.has(word)))].slice(0, 5);
      const factors: string[] = [];
      if (industry.exact) factors.push(`Same industry: ${target.industry}`);
      else if (industry.related) factors.push("Closely related industry");
      if (sameSector) factors.push(`Same sector: ${target.sector}`);
      factors.push(...facets.slice(0, 3));
      if (candidate.reviewedReason) factors.push("Reviewed competitive evidence");
      const score = industry.score
        + (sameSector ? 12 : 0)
        + Math.min(facets.length * 12, 36)
        + Math.min(commonTerms.length * 2, 10)
        + sizeScore(target.marketCap, candidate.marketCap)
        + (candidate.reviewedReason ? 45 : 0);
      return {
        ...candidate,
        selectionScore: Math.round(Math.min(score, 100) * 10) / 10,
        selectionReason: reasonFor(target, candidate, industry.exact, industry.related, facets, commonTerms),
        selectionFactors: factors,
        sourceLabel: candidate.evidenceLabel ?? NASDAQ_PEER_SOURCE_LABEL,
        sourceUrl: candidate.evidenceUrl ?? NASDAQ_PEER_SOURCE_URL,
      };
    })
    .filter((candidate) => {
      if (candidate.reviewedReason) return true;
      if (candidate.selectionScore < MIN_AUTOMATIC_PEER_SCORE) return false;
      const industry = industryScore(target.industry, candidate.industry);
      if (!industry.related) return false;
      if (!target.description || !candidate.description) return false;
      if (sharedFacets(target, candidate).length === 0) return false;
      const ratio = sizeRatio(target.marketCap, candidate.marketCap);
      if (ratio != null && ratio > MAX_AUTOMATIC_SIZE_RATIO) return false;
      if (!targetHasBroadIndustry || targetPrimaryDomains.size === 0) return true;
      const candidateDomains = businessDomains(candidate.description);
      return candidateDomains.length === 0 || candidateDomains.some((domain) => targetPrimaryDomains.has(domain));
    })
    .sort((a, b) => b.selectionScore - a.selectionScore || (b.marketCap ?? 0) - (a.marketCap ?? 0));
}
