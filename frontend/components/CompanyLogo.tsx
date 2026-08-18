"use client";

import { useEffect, useMemo, useState } from "react";
import { getInitialsBadgeStyle, getLogoCandidates, getTickerInitials } from "@/lib/logo";

export type LogoSize = "xs" | "sm" | "md" | "lg";

export interface CompanyLogoProps {
  ticker: string;
  name?: string;
  size?: LogoSize;
  priority?: boolean;
  className?: string;
  alt?: string;
}

export function CompanyLogo({
  ticker,
  name,
  size = "md",
  priority = false,
  className = "",
  alt,
}: CompanyLogoProps) {
  const candidates = useMemo(() => getLogoCandidates(ticker), [ticker]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Reset image resolution state whenever the ticker changes
  useEffect(() => {
    setCandidateIndex(0);
    setIsLoaded(false);
    setHasError(candidates.length === 0);
  }, [candidates.length, ticker]);

  const initials = useMemo(() => getTickerInitials(ticker, name), [name, ticker]);
  const badgeStyle = useMemo(() => getInitialsBadgeStyle(ticker), [ticker]);

  const currentSrc = !hasError && candidateIndex < candidates.length ? candidates[candidateIndex] : null;

  const handleImageError = () => {
    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex((prev) => prev + 1);
    } else {
      setHasError(true);
    }
  };

  const handleImageLoad = () => {
    setIsLoaded(true);
  };

  const imageAlt = alt !== undefined ? alt : `${name || ticker || "Company"} logo`;

  return (
    <div
      className={`company-logo-wrap company-logo-${size} ${className}`}
      data-loaded={isLoaded}
      data-has-error={hasError}
      aria-hidden={alt === "" ? true : undefined}
    >
      {currentSrc && !hasError && (
        <img
          key={currentSrc}
          src={currentSrc}
          alt={imageAlt}
          className={`company-logo-img ${isLoaded ? "is-visible" : "is-loading"}`}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onError={handleImageError}
          onLoad={handleImageLoad}
        />
      )}

      {(!isLoaded || hasError) && (
        <div
          className="company-logo-initials"
          style={badgeStyle}
          aria-label={imageAlt}
        >
          <span>{initials}</span>
        </div>
      )}
    </div>
  );
}
