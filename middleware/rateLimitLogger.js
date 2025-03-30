/**
 * Rate limit logging middleware
 * Logs rate limit hits and helps with monitoring potential abuse
 */

/**
 * Log rate limit hits with detailed information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const rateLimitLogger = (req, res, next) => {
  // Store the original send function
  const originalSend = res.send;

  // Override the send function
  res.send = function(body) {
    // Check if it's a rate limit error response
    // By checking for status code and examining the response body
    if (res.statusCode === 429) {
      try {
        // Log the rate limit hit with useful information
        const clientIp = req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const path = req.originalUrl || req.url;
        const method = req.method;
        
        console.warn(`[RATE LIMIT HIT] IP: ${clientIp}, Path: ${method} ${path}, User-Agent: ${userAgent}`);
        
        // Check if there's an authenticated user and log that as well
        if (req.user?.uid) {
          console.warn(`[RATE LIMIT HIT] User ID: ${req.user.uid}, Email: ${req.user.email || 'Not available'}`);
        }

        // If the body is in JSON format, try to parse it
        if (typeof body === 'string' && body.startsWith('{')) {
          try {
            const parsedBody = JSON.parse(body);
            // Add additional information to the response
            parsedBody.retryAfter = res.getHeader('Retry-After');
            body = JSON.stringify(parsedBody);
          } catch (error) {
            // Ignore JSON parsing errors
          }
        }
      } catch (error) {
        console.error('Error in rate limit logger:', error);
      }
    }

    // Call the original send function
    return originalSend.call(this, body);
  };

  next();
};

module.exports = { rateLimitLogger }; 