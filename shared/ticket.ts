const TICKET = /^[A-Z][A-Z0-9]*-[A-Z0-9]+$/;

export function normalizeTicket(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function isTicket(value: unknown): boolean {
  return TICKET.test(normalizeTicket(value));
}
