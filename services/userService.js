const User = require('../models/User');

/**
 * Create or update a user in the database
 * @param {Object} userData - User data from Firebase
 * @returns {Promise<Object>} - The created/updated user
 */
const createOrUpdateUser = async (userData) => {
  const { uid, email, displayName, photoURL } = userData;
  
  if (!uid || !email) {
    throw new Error('User ID and email are required');
  }
  
  try {
    // Find and update the user, or create if not exists
    const user = await User.findOneAndUpdate(
      { uid },
      {
        $set: {
          email,
          displayName: displayName || '',
          photoURL: photoURL || '',
          lastLogin: new Date()
        },
        $setOnInsert: {
          role: 'Free',
          createdAt: new Date()
        }
      },
      {
        new: true,
        upsert: true,
        runValidators: true
      }
    );
    
    return user;
  } catch (error) {
    console.error('Error in createOrUpdateUser:', error);
    throw error;
  }
};

/**
 * Get a user by their Firebase UID
 * @param {string} uid - Firebase UID
 * @returns {Promise<Object|null>} - The user or null if not found
 */
const getUserByUid = async (uid) => {
  try {
    // Make sure we get the full user object including providerData
    const user = await User.findOne({ uid });
    return user;
  } catch (error) {
    console.error('Error in getUserByUid:', error);
    throw error;
  }
};

/**
 * Update a user's role
 * @param {string} uid - Firebase UID
 * @param {string} role - New role ('Free' or 'Pro')
 * @returns {Promise<Object|null>} - The updated user or null if not found
 */
const updateUserRole = async (uid, role) => {
  if (!['Free', 'Pro'].includes(role)) {
    throw new Error('Invalid role. Must be either "Free" or "Pro"');
  }
  
  try {
    const updates = {
      role
    };
    
    // If upgrading to Pro, set subscription start date
    if (role === 'Pro') {
      updates.subscriptionStartDate = new Date();
    }
    
    const user = await User.findOneAndUpdate(
      { uid },
      updates,
      { new: true, runValidators: true }
    );
    
    return user;
  } catch (error) {
    console.error('Error in updateUserRole:', error);
    throw error;
  }
};

/**
 * Check if a user has Pro privileges
 * @param {string} uid - Firebase UID
 * @returns {Promise<boolean>} - True if user has Pro role, false otherwise
 */
const isUserPro = async (uid) => {
  try {
    const user = await User.findOne({ uid });
    return user?.role === 'Pro';
  } catch (error) {
    console.error('Error in isUserPro:', error);
    return false;
  }
};

/**
 * Update user's social media tokens
 * @param {string} uid - User's Firebase UID
 * @param {string} platform - Social media platform (twitter, tiktok)
 * @param {Object} tokenData - Token data to store
 * @returns {Promise<Object>} - The updated user
 */
const updateSocialMediaTokens = async (uid, platform, tokenData) => {
  if (!uid || !platform || !tokenData) {
    throw new Error('User ID, platform, and token data are required');
  }
  
  try {
    const updateQuery = {};
    const updatePath = `providerData.${platform}`;
    updateQuery[updatePath] = tokenData;
    
    const user = await User.findOneAndUpdate(
      { uid },
      { $set: updateQuery },
      { new: true, runValidators: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return user;
  } catch (error) {
    console.error(`Error updating ${platform} tokens for user ${uid}:`, error);
    throw error;
  }
};

module.exports = {
  createOrUpdateUser,
  getUserByUid,
  updateUserRole,
  isUserPro,
  updateSocialMediaTokens
}; 