import type { Context, Next } from "hono";

/**
 * Security headers middleware.
 *
 * Sets standard security headers on every response to harden the API
 * against common web vulnerabilities. These follow OWASP recommendations.
 */
export async function securityHeaders(c: Context, next: Next): Promise<void> {
  await next();

  // Prevent MIME type sniffing.
  c.header("X-Content-Type-Options", "nosniff");

  // Prevent the API from being embedded in iframes.
  c.header("X-Frame-Options", "DENY");

  // Disable referrer for API responses.
  c.header("Referrer-Policy", "no-referrer");

  // Strict transport security (Cloud Run already enforces HTTPS,
  // but this protects against protocol downgrade attacks).
  c.header(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );

  // Content Security Policy for API (no inline scripts/styles needed).
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");

  // Disable browser features not needed by an API.
  c.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
}
