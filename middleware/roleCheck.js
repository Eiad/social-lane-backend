const { isUserPro } = require('../services/userService');

/**
 * Middleware to check if a user has Pro privileges
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireProRole = async (req, res, next) => {
  try {
    // The userId should be passed in the request params or query
    const userId = req.params.userId || req.query.userId || req.body.userId;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    
    const isPro = await isUserPro(userId);
    
    if (!isPro) {
      return res.status(403).json({
        success: false,
        error: 'Pro subscription required for this feature'
      });
    }
    
    next();
  } catch (error) {
    console.error('Error in requireProRole middleware:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error while checking user role'
    });
  }
};

module.exports = {
  requireProRole
}; 