// Connection strings for a hosted database. Kept apart from the setup script so
// they can be unit tested without a terminal or a database.

const localHosts = ['localhost', '127.0.0.1', '[::1]'];

export function isLocalHost(url: URL): boolean {
  return localHosts.includes(url.hostname);
}

/** The migration URL, keeping its credentials, with verified TLS against the given CA file. */
export function migrationUrl(input: string, caPath: string): string {
  const url = new URL(input);
  url.search = '';
  url.searchParams.set('schema', 'app');
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', caPath);
  return url.toString();
}

/**
 * The API's URL: same host, restricted role. The Supabase pooler names accounts
 * `role.projectref`, so the project part of the login is carried over.
 */
export function runtimeUrl(input: string, password: string, caPath: string): string {
  const url = new URL(input);
  const project = url.username.includes('.') ? url.username.split('.').slice(1).join('.') : '';
  url.username = project ? `app_runtime.${project}` : 'app_runtime';
  url.password = password;
  url.search = '';
  url.searchParams.set('schema', 'app');
  url.searchParams.set('sslmode', 'verify-full');
  url.searchParams.set('sslrootcert', caPath);
  return url.toString();
}
