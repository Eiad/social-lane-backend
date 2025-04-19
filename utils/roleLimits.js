/**
 * Subscription plan limits for different user roles
 * This is the central place to define all role-based feature limits
 */
const roleLimits = {
  Starter: {
    socialAccounts: 4,
    numberOfPosts: 10,
    carouselPosts: true,
    priceMonthly: 0,
  },
  Launch: {
    socialAccounts: 5,
    numberOfPosts: -1, // -1 means unlimited
    carouselPosts: true,
    priceMonthly: 9,
  },
  Rise: {
    socialAccounts: 15,
    numberOfPosts: -1, // -1 means unlimited
    carouselPosts: true,
    priceMonthly: 18,
  },
  Scale: {
    socialAccounts: -1, // -1 means unlimited
    numberOfPosts: -1, // -1 means unlimited
    carouselPosts: true,
    priceMonthly: 27,
  }
};

/**
 * Check if a user has reached their limit for a specific feature
 * @param {string} role - User role (Starter, Launch, Rise, Scale)
 * @param {string} limitType - Type of limit to check (e.g., 'socialAccounts', 'numberOfPosts')
 * @param {number} currentCount - Current count of items (e.g., number of connected accounts)
 * @returns {boolean} - True if limit reached, false otherwise
 */
const hasReachedLimit = (role, limitType, currentCount) => {
  // Default to Starter if role not found
  const userRole = role && roleLimits[role] ? role : 'Starter';
  const limit = roleLimits[userRole][limitType];
  
  // If limit is -1, it means unlimited
  if (limit === -1) return false;
  
  // Check if current count EXCEEDS the limit (allow count equal to limit)
  return currentCount > limit;
};

/**
 * Get the limit value for a specific feature and role
 * @param {string} role - User role (Starter, Launch, Rise, Scale)
 * @param {string} limitType - Type of limit to get (e.g., 'socialAccounts', 'numberOfPosts')
 * @returns {number|string|boolean} - Limit value (number, string, or boolean depending on the limit type)
 */
const getLimit = (role, limitType) => {
  // Default to Starter if role not found
  const userRole = role && roleLimits[role] ? role : 'Starter';
  return roleLimits[userRole][limitType];
};

/**
 * Check if a feature is available for a specific role
 * @param {string} role - User role (Starter, Launch, Rise, Scale)
 * @param {string} feature - Feature to check (e.g., 'contentStudio', 'carouselPosts')
 * @returns {boolean} - True if feature is available, false otherwise
 */
const hasFeature = (role, feature) => {
  // Default to Starter if role not found
  const userRole = role && roleLimits[role] ? role : 'Starter';
  return !!roleLimits[userRole][feature];
};

/**
 * Get all plan details
 * @returns {Object} - All plan details
 */
const getAllPlans = () => {
  return {
    Starter: { ...roleLimits.Starter, name: 'Starter', tier: 'Starter' },
    Launch: { ...roleLimits.Launch, name: 'Launch', tier: 'Launch' },
    Rise: { ...roleLimits.Rise, name: 'Rise', tier: 'Rise' },
    Scale: { ...roleLimits.Scale, name: 'Scale', tier: 'Scale' }
  };
};

module.exports = {
  roleLimits,
  hasReachedLimit,
  getLimit,
  hasFeature,
  getAllPlans
}; 