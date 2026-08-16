export const ANALYSIS_SCHEMA_VERSION = 6;
export const NORMALIZATION_VERSION = "sec-normalizer-1.2";
export const VALUATION_MODEL_VERSION = "valuation-0.2.2";
export const SCORE_MODEL_VERSION = "score-peg-1.0";

export const COMPONENT_SOURCE_VERSIONS = {
  quote: "nasdaq-quote-1.0",
  analyst_estimates: "nasdaq-estimates-1.0",
  comps: "comps-engine-3.1",
  risks: "sec-risk-themes-2.2",
  news: "news-aggregate-1.1",
} as const;
