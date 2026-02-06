/**
 * Authentication module for Claude Workspace Manager Web API.
 * Uses a simple in-memory token approach with Bearer token auth.
 *
 * - POST /api/auth/login  - Validates password, returns a Bearer token
 * - POST /api/auth/logout - Invalidates the token
 * - GET  /api/auth/check  - Validates current token
 *
 * Protected routes use the requireAuth middleware which checks
 * the Authorization: Bearer <token> header.
 */

const crypto = require('crypto');

// ─── Configuration ─────────────────────────────────────────
const AUTH_PASSWORD = 'Sparktech123!';
const TOKEN_BYTE_LENGTH = 32;

// In-memory set of valid tokens. Tokens survive for the lifetime of
// the server process. A restart invalidates all tokens (acceptable
// for a local dev-tool).
const activeTokens = new Set();

// ─── Helpers ───────────────────────────────────────────────

/**
 * Generate a cryptographically random hex token.
 * @returns {string} 64-character hex string
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
}

/**
 * Extract the Bearer token from an Authorization header value.
 * Returns null if the header is missing or malformed.
 * @param {string|undefined} headerValue - The raw Authorization header
 * @returns {string|null}
 */
function extractBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const parts = headerValue.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

// ─── Middleware ─────────────────────────────────────────────

/**
 * Express middleware that requires a valid Bearer token.
 * Responds with 401 if the token is missing or invalid.
 */
function requireAuth(req, res, next) {
  const token = extractBearerToken(req.headers.authorization);
  console.log('[AUTH] requireAuth called for:', req.method, req.originalUrl, 'token:', token ? token.substring(0, 8) + '...' : 'NONE');

  if (!token || !activeTokens.has(token)) {
    console.log('[AUTH] requireAuth REJECTED:', req.method, req.originalUrl);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid Bearer token required. POST /api/auth/login to authenticate.',
    });
  }

  // Attach token to request for downstream use (e.g. logout)
  req.authToken = token;
  next();
}

// ─── Route Setup ───────────────────────────────────────────

/**
 * Mount authentication routes on the Express app.
 * These routes are NOT protected by requireAuth — they are public.
 *
 * @param {import('express').Express} app - The Express application
 */
function setupAuth(app) {
  /**
   * POST /api/auth/login
   * Body: { password: string }
   * Returns: { success: true, token: string } or { success: false, error: string }
   */
  app.post('/api/auth/login', (req, res) => {
    const { password } = req.body || {};

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid password field in request body.',
      });
    }

    // Constant-time comparison to mitigate timing attacks
    const passwordBuffer = Buffer.from(password, 'utf-8');
    const expectedBuffer = Buffer.from(AUTH_PASSWORD, 'utf-8');
    const isValid =
      passwordBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(passwordBuffer, expectedBuffer);

    if (!isValid) {
      return res.status(403).json({
        success: false,
        error: 'Invalid password.',
      });
    }

    const token = generateToken();
    activeTokens.add(token);
    console.log('[AUTH] Token created:', token.substring(0, 16) + '...');
    console.log('[AUTH] Active tokens count:', activeTokens.size);

    return res.json({ success: true, token });
  });

  /**
   * POST /api/auth/logout
   * Requires Authorization: Bearer <token>
   * Removes the token from the active set.
   */
  app.post('/api/auth/logout', (req, res) => {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
      activeTokens.delete(token);
    }

    return res.json({ success: true });
  });

  /**
   * GET /api/auth/check
   * Returns whether the provided Bearer token is still valid.
   */
  app.get('/api/auth/check', (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const authenticated = !!token && activeTokens.has(token);

    return res.json({ authenticated });
  });
}

/**
 * Check if a raw token string is valid (exists in activeTokens).
 * Used by SSE endpoint which can't use requireAuth middleware.
 * @param {string} token - The raw token string
 * @returns {boolean}
 */
function isValidToken(token) {
  const result = !!token && activeTokens.has(token);
  console.log('[AUTH] isValidToken called:', token ? token.substring(0, 16) + '...' : 'NONE', 'result:', result, 'activeTokens.size:', activeTokens.size);
  return result;
}

// ─── Exports ───────────────────────────────────────────────

module.exports = {
  setupAuth,
  requireAuth,
  isValidToken,
};
