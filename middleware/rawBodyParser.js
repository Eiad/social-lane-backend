/**
 * Middleware to capture raw request body for PayPal webhook verification
 * This is needed because we need the raw body to verify the webhook signature
 */
const rawBodyParser = (req, res, next) => {
  if (req.originalUrl === '/paypal/webhook' && req.method === 'POST') {
    let rawBody = '';
    
    req.on('data', chunk => {
      rawBody += chunk.toString();
    });
    
    req.on('end', () => {
      req.rawBody = rawBody;
      next();
    });
  } else {
    next();
  }
};

module.exports = rawBodyParser; 