"use client";

import type { ButtonHTMLAttributes, ComponentType, InputHTMLAttributes, ReactNode } from "react";

type IconComponent = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

export function Button({
  children,
  className = "",
  iconDescription: _iconDescription,
  kind = "primary",
  renderIcon: Icon,
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  iconDescription?: string;
  kind?: "primary" | "tertiary" | "ghost";
  renderIcon?: IconComponent;
  size?: "sm" | "md";
}) {
  return (
    <button className={`cds--btn cds--btn--${kind} cds--btn--${size} ${className}`.trim()} {...props}>
      <span>{children}</span>
      {Icon && <Icon size={16} className="cds--btn__icon" aria-hidden />}
    </button>
  );
}

export function TextInput({
  hideLabel: _hideLabel,
  labelText: _labelText,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { hideLabel?: boolean; labelText?: string }) {
  return <input className={`cds--text-input ${className}`.trim()} {...props} />;
}

export function InlineNotification({
  hideCloseButton: _hideCloseButton,
  kind,
  lowContrast: _lowContrast,
  subtitle,
  title,
}: {
  hideCloseButton?: boolean;
  kind: "error" | "warning";
  lowContrast?: boolean;
  subtitle: string;
  title: string;
}) {
  return (
    <div className={`cds--inline-notification cds--inline-notification--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <span className="cds--inline-notification__icon" aria-hidden>{kind === "error" ? "×" : "!"}</span>
      <div className="cds--inline-notification__details">
        <strong className="cds--inline-notification__title">{title}</strong>
        <span className="cds--inline-notification__subtitle">{subtitle}</span>
      </div>
    </div>
  );
}

export function SkeletonText({
  heading = false,
  lineCount = 1,
  paragraph = false,
  width,
}: {
  heading?: boolean;
  lineCount?: number;
  paragraph?: boolean;
  width?: string;
}) {
  const lines = paragraph ? lineCount : 1;
  return (
    <div className={`cds--skeleton__text${heading ? " cds--skeleton__heading" : ""}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} style={{ width: index === lines - 1 && paragraph ? "72%" : width }} />
      ))}
    </div>
  );
}

export function Tag({ children, type = "gray" }: { children: ReactNode; type?: string }) {
  return <span className={`cds--tag cds--tag--${type}`}>{children}</span>;
}

export function Theme({ children, theme }: { children: ReactNode; theme: string }) {
  return <div className={`cds--${theme}`}>{children}</div>;
}
