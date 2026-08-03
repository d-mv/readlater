export function deeplApiBase(apiKey: string): string {
  return apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

export function normalizeTargetLang(lang: string): string {
  return lang.trim().toUpperCase();
}
