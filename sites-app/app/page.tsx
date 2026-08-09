import { ResearchTerminal } from "../../frontend/components/ResearchTerminal";
import { readCachedAnalysis } from "@/lib/server/analysis-cache";
import { buildOverviewSnapshot, markSnapshotFreshness } from "@/lib/server/analysis-service";

export default async function Home() {
  const cached = await readCachedAnalysis("AAPL");
  const initialAnalysis = cached
    ? buildOverviewSnapshot(markSnapshotFreshness(cached.analysis, cached.isFresh ? "cached" : "stale"))
    : null;
  return <ResearchTerminal initialAnalysis={initialAnalysis} />;
}
