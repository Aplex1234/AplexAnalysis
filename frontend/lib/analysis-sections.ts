import type { Analysis, AnalysisSection } from "./types";

type DeferredSection = Exclude<AnalysisSection, "overview">;
export type AnalysisSectionPanelState = "content" | "loading" | "error";

export function isAnalysisSectionLoaded(analysis: Pick<Analysis, "data_scope" | "loaded_sections">, section: AnalysisSection) {
  if (section === "overview") return true;
  if (analysis.loaded_sections) return analysis.loaded_sections.includes(section);
  return analysis.data_scope !== "overview";
}

export function analysisSectionPanelState(
  analysis: Pick<Analysis, "data_scope" | "loaded_sections">,
  section: AnalysisSection,
  loadingSection: DeferredSection | null,
  sectionError: string | null,
): AnalysisSectionPanelState {
  if (isAnalysisSectionLoaded(analysis, section)) return "content";
  if (sectionError) return "error";
  if (loadingSection === section) return "loading";
  return "loading";
}

export function mergeAnalysisSection(current: Analysis, next: Analysis, section: AnalysisSection): Analysis {
  if (next.data_scope === "full") return next;
  const detailedFinancials = ["financials", "valuation", "buyTarget"].includes(section);
  const loadedSections = new Set<AnalysisSection>([
    ...(current.loaded_sections ?? ["overview"]),
    ...(next.loaded_sections ?? [section]),
  ]);
  const currentFreshness = current.freshness;
  const nextFreshness = next.freshness;
  const mergedFreshness = currentFreshness && nextFreshness ? {
    ...nextFreshness,
    analyst_estimates: section === "earnings" ? nextFreshness.analyst_estimates : currentFreshness.analyst_estimates,
    comps: section === "comps" ? nextFreshness.comps : currentFreshness.comps,
    news: section === "news" ? nextFreshness.news : currentFreshness.news,
    risks: section === "risks" ? nextFreshness.risks : currentFreshness.risks,
  } : nextFreshness ?? currentFreshness;
  const warnings = [...new Set([
    ...(current.provenance.warnings ?? []),
    ...(next.provenance.warnings ?? []),
  ])];

  return {
    ...current,
    ...next,
    data_scope: "partial",
    loaded_sections: [...loadedSections],
    financials: detailedFinancials ? next.financials : current.financials,
    quarterly_financials: detailedFinancials ? next.quarterly_financials : current.quarterly_financials,
    analyst_estimates: section === "earnings" ? next.analyst_estimates : current.analyst_estimates,
    comps: section === "comps" ? next.comps : current.comps,
    peer_selection: section === "comps" ? next.peer_selection : current.peer_selection,
    filings: section === "filings" ? next.filings : current.filings,
    risks: section === "risks" ? next.risks : current.risks,
    news: section === "news" ? next.news : current.news,
    freshness: mergedFreshness,
    provenance: {
      ...next.provenance,
      analyst_estimates: section === "earnings" ? next.provenance.analyst_estimates : current.provenance.analyst_estimates,
      risk_factors: section === "risks" ? next.provenance.risk_factors : current.provenance.risk_factors,
      news: section === "news" ? next.provenance.news : current.provenance.news,
      comparables: section === "comps" ? next.provenance.comparables : current.provenance.comparables,
      peer_snapshot_as_of: section === "comps" ? next.provenance.peer_snapshot_as_of : current.provenance.peer_snapshot_as_of,
      warnings,
    },
  };
}
