import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  cik: text("cik").notNull(),
  name: text("name").notNull(),
  sector: text("sector"),
  industry: text("industry"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_companies_cik").on(table.cik),
]);

export const listings = sqliteTable("listings", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  exchange: text("exchange"),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_listings_exchange_ticker").on(table.exchange, table.ticker),
  index("idx_listings_ticker").on(table.ticker),
  index("idx_listings_company_id").on(table.companyId),
]);

export const normalizedFinancialCache = sqliteTable("normalized_financial_cache", {
  companyId: text("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  annualJson: text("annual_json").notNull(),
  quarterlyJson: text("quarterly_json").notNull(),
  filingsJson: text("filings_json").notNull(),
  latestJson: text("latest_json").notNull(),
  provenanceJson: text("provenance_json").notNull(),
  normalizationVersion: text("normalization_version").notNull(),
  normalizedAt: text("normalized_at").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const analysisCache = sqliteTable("analysis_cache", {
  listingId: text("listing_id").primaryKey().references(() => listings.id, { onDelete: "cascade" }),
  payloadJson: text("payload_json").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  generatedAt: text("generated_at").notNull(),
  freshUntil: text("fresh_until").notNull(),
  refreshStartedAt: text("refresh_started_at"),
  lastRefreshError: text("last_refresh_error"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_analysis_cache_fresh_until").on(table.freshUntil),
]);
