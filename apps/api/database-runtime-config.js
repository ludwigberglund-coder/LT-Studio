'use strict';

function databaseConfigError(message, code='DATABASE_CONFIG_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeEngine(value) {
  const raw = clean(value || 'sqlite').toLowerCase();
  if (raw === 'postgres' || raw === 'supabase') return 'postgresql';
  if (raw === 'sqlite' || raw === 'postgresql') return raw;
  throw databaseConfigError(
    'LT_DATABASE_ENGINE måste vara sqlite eller postgresql.',
    'INVALID_DATABASE_ENGINE'
  );
}

function assertPostgresUrl(value) {
  const raw = clean(value);
  if (!raw) {
    throw databaseConfigError(
      'SUPABASE_DATABASE_URL krävs när LT_DATABASE_ENGINE=postgresql.',
      'MISSING_SUPABASE_DATABASE_URL'
    );
  }
  let parsed;
  try { parsed = new URL(raw); }
  catch {
    throw databaseConfigError(
      'SUPABASE_DATABASE_URL är inte en giltig PostgreSQL-URL.',
      'INVALID_SUPABASE_DATABASE_URL'
    );
  }
  if (!['postgres:','postgresql:'].includes(parsed.protocol)) {
    throw databaseConfigError(
      'SUPABASE_DATABASE_URL måste använda postgresql://.',
      'INVALID_SUPABASE_DATABASE_URL'
    );
  }
  if (!parsed.hostname || !parsed.username) {
    throw databaseConfigError(
      'SUPABASE_DATABASE_URL saknar server eller användare.',
      'INVALID_SUPABASE_DATABASE_URL'
    );
  }
  return raw;
}

function resolveDatabaseTarget(env=process.env) {
  const engine = normalizeEngine(env.LT_DATABASE_ENGINE);
  if (engine === 'sqlite') {
    return Object.freeze({
      engine,
      databasePath: clean(env.ROLLANDS_DATABASE_PATH) || null,
      shared: false
    });
  }

  const databaseUrl = assertPostgresUrl(env.SUPABASE_DATABASE_URL);
  return Object.freeze({
    engine,
    databaseUrl,
    shared: true
  });
}

function describeDatabaseTarget(target) {
  if (!target || target.engine === 'sqlite') {
    return Object.freeze({engine:'sqlite', shared:false});
  }
  const parsed = new URL(target.databaseUrl);
  return Object.freeze({
    engine:'postgresql',
    shared:true,
    host:parsed.hostname,
    database:parsed.pathname.replace(/^\//,'') || 'postgres'
  });
}

module.exports = Object.freeze({
  normalizeEngine,
  resolveDatabaseTarget,
  describeDatabaseTarget
});
