/**
 * Authentication middleware to protect routes
 * Verifies Firebase ID token and attaches user data to request
 */
const admin = require('firebase-admin');

/**
 * Authentication middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - No token provided'
      });
    }
    
    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify the token
    try {
      // Check if Firebase admin is initialized
      if (!admin.apps.length) {
        console.log('Firebase admin not initialized in auth middleware');
        
        // For development, allow bypassing authentication if BYPASS_AUTH env var is set
        if (process.env.NODE_ENV === 'development' && process.env.BYPASS_AUTH === 'true') {
          console.log('DEVELOPMENT MODE: Bypassing authentication');
          return next();
        }
        
        return res.status(500).json({
          success: false,
          error: 'Internal server error - Authentication service not initialized'
        });
      }
      
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
      
      return next();
    } catch (tokenError) {
      console.error('Error verifying authentication token:', tokenError);
      
      // For development, allow bypassing authentication if BYPASS_AUTH env var is set
      if (process.env.NODE_ENV === 'development' && process.env.BYPASS_AUTH === 'true') {
        console.log('DEVELOPMENT MODE: Bypassing authentication after token error');
        return next();
      }
      
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - Invalid token'
      });
    }
  } catch (error) {
    console.error('Error in auth middleware:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

module.exports = { auth }; 