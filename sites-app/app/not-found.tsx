import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <p className="eyebrow">404 / PAGE NOT FOUND</p>
      <h1>This page is not part of the terminal.</h1>
      <p>The link may be outdated. Return to the company overview and continue your research.</p>
      <Link className="not-found-link" href="/">Return to AplexAnalysis</Link>
    </main>
  );
}
