export function contentSecurityPolicy({ development = false, frameAncestors = false } = {}) {
  const sources = ["'self'", "https://api.openai.com", "https://openrouter.ai", "https://api.anthropic.com", "http://localhost:*", "http://127.0.0.1:*", "https://localhost:*", "https://127.0.0.1:*", ...(development ? ["ws://127.0.0.1:*", "ws://localhost:*"] : [])];
  return `default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src ${development ? "'self' 'unsafe-inline'" : "'self'"}; img-src 'self' data: blob:; font-src 'self'; connect-src ${sources.join(" ")}; worker-src 'self'; manifest-src 'self'; form-action 'self'${frameAncestors ? "; frame-ancestors 'none'" : ""}`;
}
