import type { Request } from "express";

/**
 * A2A authentication for the protocols service.
 *
 * Implements a custom UserBuilder that validates incoming A2A requests
 * by checking for a Bearer token or X-API-Key header. The token is
 * verified by calling the control plane's auth endpoint.
 *
 * In development (no CONTROL_PLANE_URL or auth disabled), falls back
 * to allowing unauthenticated access with a warning.
 */

/** Minimal User interface matching @a2a-js/sdk's User contract. */
interface A2AUser {
  get isAuthenticated(): boolean;
  get userName(): string;
}

class AuthenticatedA2AUser implements A2AUser {
  private readonly _userName: string;

  constructor(userName: string) {
    this._userName = userName;
  }

  get isAuthenticated(): boolean {
    return true;
  }

  get userName(): string {
    return this._userName;
  }
}

class UnauthenticatedA2AUser implements A2AUser {
  get isAuthenticated(): boolean {
    return false;
  }

  get userName(): string {
    return "anonymous";
  }
}

function getControlPlaneUrl(): string {
  return process.env["CONTROL_PLANE_URL"] ?? "http://localhost:8080";
}

/**
 * Validate a Bearer token by calling the control plane.
 *
 * Makes a lightweight request to GET /health with the token to verify
 * it's valid. In a production setup, this could call a dedicated
 * /auth/verify endpoint instead.
 *
 * Returns the user ID if valid, null otherwise.
 */
async function validateToken(token: string): Promise<string | null> {
  try {
    const cpUrl = getControlPlaneUrl();
    // Use the agents endpoint with a HEAD-like request to validate auth.
    // The control plane's auth middleware will reject invalid tokens.
    const res = await fetch(`${cpUrl}/agents?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      // Token is valid. We don't have the user ID from this response,
      // so use a hash of the token as identifier.
      return `bearer:${token.slice(-8)}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate an API key by calling the control plane.
 */
async function validateApiKey(apiKey: string): Promise<string | null> {
  try {
    const cpUrl = getControlPlaneUrl();
    const res = await fetch(`${cpUrl}/agents?limit=1`, {
      headers: { "X-API-Key": apiKey },
    });
    if (res.ok) {
      return `apikey:${apiKey.slice(-8)}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Custom UserBuilder for A2A endpoints.
 *
 * Checks for Bearer token or X-API-Key in the request headers.
 * If A2A_AUTH_REQUIRED is not set to "true", allows unauthenticated
 * access (suitable for development).
 */
export async function a2aUserBuilder(req: Request): Promise<A2AUser> {
  const authRequired = process.env["A2A_AUTH_REQUIRED"] === "true";

  // Check Bearer token.
  const authHeader = req.headers["authorization"];
  if (authHeader && typeof authHeader === "string") {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    if (token) {
      const userId = await validateToken(token);
      if (userId) {
        return new AuthenticatedA2AUser(userId);
      }
      if (authRequired) {
        // Invalid token and auth is required -- still return unauthenticated.
        // The A2A SDK will handle the rejection based on isAuthenticated.
        return new UnauthenticatedA2AUser();
      }
    }
  }

  // Check API key.
  const apiKey = req.headers["x-api-key"];
  if (apiKey && typeof apiKey === "string") {
    const userId = await validateApiKey(apiKey);
    if (userId) {
      return new AuthenticatedA2AUser(userId);
    }
    if (authRequired) {
      return new UnauthenticatedA2AUser();
    }
  }

  // No credentials provided.
  if (authRequired) {
    return new UnauthenticatedA2AUser();
  }

  // In development, allow unauthenticated access.
  return new AuthenticatedA2AUser("anonymous-dev");
}
