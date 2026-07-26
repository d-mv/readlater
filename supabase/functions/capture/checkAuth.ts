export function checkAuth(authHeader: string | null, expectedKey: string): boolean {
  if (!expectedKey) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  return authHeader.slice("Bearer ".length) === expectedKey;
}
