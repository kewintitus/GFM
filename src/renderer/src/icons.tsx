export function Mark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? "mark lg" : "mark"} aria-hidden="true">
      <span /><span /><span /><span />
    </span>
  );
}

export function IconCommit() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v5M12 15.5v5" />
    </svg>
  );
}

export function IconCatalog() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6h10M9 12h10M9 18h10" />
      <circle cx="5" cy="6" r="1.2" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="5" cy="18" r="1.2" />
    </svg>
  );
}

export function IconFeatures() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h9" />
    </svg>
  );
}

export function IconPromote() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V6" />
      <path d="M7 10.5 12 5.5l5 5" />
    </svg>
  );
}

export function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.2-5.5" />
      <path d="M20 4.5V10h-5.5" />
    </svg>
  );
}

export function IconEnvironments() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="4.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="4" y="13" width="6.5" height="6.5" rx="1.4" />
      <rect x="13.5" y="13" width="6.5" height="6.5" rx="1.4" />
    </svg>
  );
}

export function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8.5h6l2 2H20v8.5H4z" />
      <path d="M4 8.5V7h5l1.5 1.5" />
    </svg>
  );
}

export function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" />
    </svg>
  );
}

export function IconSidebar() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10 3.5 5.5 8 10 12.5" />
    </svg>
  );
}
