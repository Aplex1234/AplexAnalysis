from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticker: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    cik: Mapped[str | None] = mapped_column(String(10), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    sector: Mapped[str | None] = mapped_column(String(120))
    industry: Mapped[str | None] = mapped_column(String(160))
    exchange: Mapped[str | None] = mapped_column(String(32))
    description: Mapped[str | None] = mapped_column(Text)
    fiscal_year_end: Mapped[str | None] = mapped_column(String(4))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    periods: Mapped[list["FinancialPeriod"]] = relationship(back_populates="company", cascade="all, delete-orphan")
    filings: Mapped[list["Filing"]] = relationship(back_populates="company", cascade="all, delete-orphan")


class FinancialPeriod(Base):
    __tablename__ = "financial_periods"
    __table_args__ = (
        UniqueConstraint("company_id", "fiscal_year", "period_type", name="uq_company_period"),
        Index("ix_period_company_year", "company_id", "fiscal_year"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    fiscal_year: Mapped[int] = mapped_column(Integer)
    period_type: Mapped[str] = mapped_column(String(8), default="FY")
    period_end: Mapped[date | None] = mapped_column(Date)
    filed_at: Mapped[date | None] = mapped_column(Date)
    accession_number: Mapped[str | None] = mapped_column(String(32))
    form: Mapped[str] = mapped_column(String(16), default="10-K")
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    values: Mapped[dict[str, Any]] = mapped_column(JSON)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON)

    company: Mapped[Company] = relationship(back_populates="periods")


class Filing(Base):
    __tablename__ = "filings"
    __table_args__ = (UniqueConstraint("company_id", "accession_number", name="uq_company_filing"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    form: Mapped[str] = mapped_column(String(24))
    filing_date: Mapped[date] = mapped_column(Date)
    report_date: Mapped[date | None] = mapped_column(Date)
    accession_number: Mapped[str] = mapped_column(String(32))
    primary_document: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str] = mapped_column(Text)

    company: Mapped[Company] = relationship(back_populates="filings")


class AnalysisSnapshot(Base):
    __tablename__ = "analysis_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    as_of: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    current_price: Mapped[float | None] = mapped_column(Float)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    methodology_version: Mapped[str] = mapped_column(String(24), default="0.1.0")
