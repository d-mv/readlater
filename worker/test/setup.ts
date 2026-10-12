// Bun loads worker/.env automatically, including for `bun test`. A developer's
// real Supabase credentials would then wire the module-level client to the
// live project and turn unit tests into network calls. Tests start from an
// unconfigured environment; a test that needs env sets it explicitly.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("SUPABASE_")) delete process.env[key];
}
