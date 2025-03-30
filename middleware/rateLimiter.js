/**
 * Rate limiting middleware configurations
 * Implements different rate limiters for various API endpoints
 */
const rateLimit = require('express-rate-limit');

// Load environment variables for configuration
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // Default: 15 minutes
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 100; // Default: 100 requests
const RATE_LIMIT_AUTH_MAX = parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10; // Default: 10 requests
const RATE_LIMIT_USER_MAX = parseInt(process.env.RATE_LIMIT_USER_MAX) || 50; // Default: 50 requests
const RATE_LIMIT_POSTING_MAX = parseInt(process.env.RATE_LIMIT_POSTING_MAX) || 20; // Default: 20 requests

// Configure trusted proxy setup
const TRUSTED_PROXIES = process.env.TRUSTED_PROXIES ? process.env.TRUSTED_PROXIES.split(',') : [];

// Helper function to get client IP
const getClientIp = (req) => {
  // Try to get IP from headers first (when behind proxy)
  const xForwardedFor = req.headers['x-forwarded-for'];
  
  if (xForwardedFor) {
    // Get the client's IP from the x-forwarded-for header
    const ips = xForwardedFor.split(',').map(ip => ip.trim());
    // Return the leftmost IP in the X-Forwarded-For header
    return ips[0];
  }
  
  // Fallback to direct connection IP
  return req.ip || req.connection.remoteAddress;
};

// Default rate limiter for general API endpoints
const defaultLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  },
  skipSuccessfulRequests: false, // Don't skip successful requests
  skipFailedRequests: false, // Don't skip failed requests
  // Use a custom IP retrieval function
  keyGenerator: (req) => getClientIp(req),
  // Skip rate limiting for trusted IPs (like internal services)
  skip: (req) => {
    const clientIp = getClientIp(req);
    return process.env.NODE_ENV === 'development' || TRUSTED_PROXIES.includes(clientIp);
  }
});

// Strict rate limiter for auth-related endpoints
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.'
  },
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    const clientIp = getClientIp(req);
    return process.env.NODE_ENV === 'development' || TRUSTED_PROXIES.includes(clientIp);
  }
});

// More permissive limiter for user-specific endpoints
const userLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: RATE_LIMIT_USER_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  },
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    const clientIp = getClientIp(req);
    return process.env.NODE_ENV === 'development' || TRUSTED_PROXIES.includes(clientIp);
  }
});

// Specific limiter for social media posting endpoints
const postingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: RATE_LIMIT_POSTING_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Posting rate limit exceeded. Please try again later.'
  },
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    const clientIp = getClientIp(req);
    return process.env.NODE_ENV === 'development' || TRUSTED_PROXIES.includes(clientIp);
  }
});

// Very permissive limiter for public endpoints like assets
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later.'
  },
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => {
    const clientIp = getClientIp(req);
    return process.env.NODE_ENV === 'development' || TRUSTED_PROXIES.includes(clientIp);
  }
});

module.exports = {
  defaultLimiter,
  authLimiter,
  userLimiter,
  postingLimiter,
  publicLimiter
}; 