// API client. The short-lived access token stays in memory. The rotating refresh
// token is kept for this browser tab only, so closing the tab signs out.

const base = '/api/v1';
const refreshKey = 'tfm.refresh_token';

export type User = { id: string; email: string; display_name: string | null; role: string; packager_id: string | null };
type TokenResponse = { access_token: string; refresh_token: string; user: User };

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string,
    readonly fields?: Record<string, string[] | undefined>) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<User | null> | null = null;
let onSignedOut: () => void = () => {};

export function setSignedOutHandler(handler: () => void) { onSignedOut = handler; }

function readRefresh(): string | null {
  try { return sessionStorage.getItem(refreshKey); } catch { return null; }
}
function storeTokens(tokens: TokenResponse) {
  accessToken = tokens.access_token;
  try { sessionStorage.setItem(refreshKey, tokens.refresh_token); } catch { /* signed in until reload */ }
}
function clearTokens() {
  accessToken = null;
  try { sessionStorage.removeItem(refreshKey); } catch { /* nothing stored */ }
}

async function failure(response: Response): Promise<ApiFailure> {
  const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string;
    fields?: Record<string, string[] | undefined> } } | null;
  const fallback = response.status === 429 ? 'Too many attempts. Wait a minute and try again.'
    : response.status >= 500 ? 'The server could not complete this. Check the API is running.' : 'Request failed';
  return new ApiFailure(response.status, body?.error?.code ?? 'ERROR', body?.error?.message ?? fallback, body?.error?.fields);
}

async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${base}${path}`, init);
  } catch {
    throw new ApiFailure(0, 'NETWORK', 'Cannot reach the API. Check it is running.');
  }
}

// Refresh tokens are single use and reuse ends the session, so concurrent
// callers must share one refresh.
export function refreshSession(): Promise<User | null> {
  refreshing ??= (async () => {
    const token = readRefresh();
    if (!token) return null;
    const response = await send('/auth/refresh', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: token }) });
    if (!response.ok) {
      if (response.status === 401) clearTokens();
      return null;
    }
    const tokens = await response.json() as TokenResponse;
    storeTokens(tokens);
    return tokens.user;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

type Options = { method?: string; body?: unknown; idempotencyKey?: string };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const attempt = () => send(path, { method: options.method ?? 'GET', headers: {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
  }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  let response = await attempt();
  if (response.status === 401) {
    if (!await refreshSession()) { clearTokens(); onSignedOut(); throw await failure(response); }
    response = await attempt();
  }
  if (!response.ok) throw await failure(response);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function signIn(email: string, password: string): Promise<User> {
  const response = await send('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }) });
  if (!response.ok) throw await failure(response);
  const tokens = await response.json() as TokenResponse;
  storeTokens(tokens);
  return tokens.user;
}

export async function signOut(): Promise<void> {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* the local sign-out still happens */ } finally { clearTokens(); }
}

/** Runs a create so that a lost connection can retry without creating it twice. */
export function createKeyHolder() {
  let key = crypto.randomUUID();
  return {
    current: () => key,
    // A real answer from the server means the next attempt is a new request.
    settle: (error?: unknown) => {
      if (!(error instanceof ApiFailure) || error.status !== 0) key = crypto.randomUUID();
    },
  };
}

export type Packager = { id: string; name: string; phone: string | null; notes: string | null;
  credit_limit_paise: number | null; is_archived: boolean };
export type Leg = { id: string; sequence: number; boarding_station: string; destination_station: string;
  journey_date: string; train_identifier: string; fare_paise: number; booking_account_id: string | null;
  pnr: string | null; ticket_status: string };
export type TrackedLeg = Leg & { booking_id: string; packager_id: string; packager_name: string;
  ticket_type: string; booking_person_mobile: string | null };
export type BookingAccount = { id: string; name: string; kind: string; login_id: string | null;
  notes: string | null; is_active: boolean };
export type ChargeRule = { id: string; packager_id: string | null; ticket_type: string; charge_paise: number };
export type Quote = { ticket_price_paise: number; service_charge_paise: number; total_paise: number;
  note: string | null; quoted_at: string | null };
export type JourneyRequest = { id: string; boarding_station: string; destination_station: string; journey_date: string;
  train_identifier: string | null; ticket_type: string; passenger_count: number; agency_note: string | null;
  status: string; quote: Quote | null; decline_reason: string | null; booking_id: string | null;
  packager_id: string; packager_name: string; requested_by: { email: string; display_name: string | null };
  created_at: string };

export const ticketStatuses = ['requested', 'booked', 'confirmed', 'waitlisted', 'rac', 'cancelled', 'travelled'];
