// The token of an `Authorization: Bearer <token>` header; null for a missing
// header, another scheme or an empty token.
export function bearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  return token === "" ? null : token;
}

// Constant-time static bearer-token check, shared by capture (the legacy
// CAPTURE_KEY fallback) and storage-sweep (the service-role key).
export function checkAuth(
  authHeader: string | null,
  expectedKey: string,
): boolean {
  if (!expectedKey) return false;
  const token = bearerToken(authHeader);
  if (token === null) return false;
  if (token.length !== expectedKey.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expectedKey.charCodeAt(i);
  }
  return mismatch === 0;
}
