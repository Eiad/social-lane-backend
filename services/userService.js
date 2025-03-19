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
          role: 'Starter',
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
 * @param {string} role - New role ('Starter', 'Launch', 'Rise', or 'Scale')
 * @returns {Promise<Object|null>} - The updated user or null if not found
 */
const updateUserRole = async (uid, role) => {
  if (!['Starter', 'Launch', 'Rise', 'Scale'].includes(role)) {
    throw new Error('Invalid role. Must be one of: Starter, Launch, Rise, Scale');
  }
  
  try {
    const updates = {
      role
    };
    
    // If upgrading from Starter, set subscription start date
    if (role !== 'Starter') {
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
 * @param {string} provider - Social media provider (e.g., 'twitter', 'tiktok')
 * @param {Array|Object} tokenData - Token data to store
 * @returns {Promise<Object>} - The updated user
 */
const updateSocialMediaTokens = async (uid, provider, tokenData) => {
  if (!uid || !provider || !tokenData) {
    throw new Error('User ID, provider, and token data are required');
  }
  
  try {
    // First get the user to check current tokens
    const user = await User.findOne({ uid });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Initialize providerData if it doesn't exist
    if (!user.providerData) {
      user.providerData = new Map();
    }
    
    // For TikTok, handle multiple accounts
    if (provider === 'tiktok') {
      if (!Array.isArray(tokenData)) {
        throw new Error('TikTok token data must be an array');
      }
      
      // Validate and clean each account's data
      const validatedAccounts = tokenData.map(account => ({
        accessToken: account?.accessToken || '',
        openId: account?.openId || '',
        refreshToken: account?.refreshToken || '',
        username: account?.username || account?.userInfo?.username || `TikTok Account ${account?.index || 0}`,
        displayName: account?.displayName || account?.userInfo?.display_name || '',
        avatarUrl: account?.avatarUrl || account?.userInfo?.avatar_url || '',
        avatarUrl100: account?.avatarUrl100 || account?.userInfo?.avatar_url_100 || '',
        index: account?.index || 0
      }));
      
      // Update the user's TikTok accounts
      user.providerData.set(provider, validatedAccounts);
    } else {
      // For other providers, just store the token data as is
      user.providerData.set(provider, tokenData);
    }
    
    // Save the updated user
    await user.save();
    
    return user;
  } catch (error) {
    console.error(`Error updating ${provider} tokens for user ${uid}:`, error);
    throw error;
  }
};

/**
 * Remove user's social media connection
 * @param {string} uid - User's Firebase UID
 * @param {string} platform - Social media platform (twitter, tiktok)
 * @returns {Promise<Object>} - The updated user
 */
const removeSocialMediaConnection = async (uid, platform) => {
  if (!uid || !platform) {
    throw new Error('User ID and platform are required');
  }
  
  try {
    const updateQuery = {};
    const updatePath = `providerData.${platform}`;
    updateQuery[updatePath] = null;
    
    const user = await User.findOneAndUpdate(
      { uid },
      { $unset: updateQuery },
      { new: true, runValidators: true }
    );
    
    if (!user) {
      throw new Error('User not found');
    }
    
    return user;
  } catch (error) {
    console.error(`Error removing ${platform} connection for user ${uid}:`, error);
    throw error;
  }
};

/**
 * Remove a specific TikTok account from user's TikTok connections
 * @param {string} uid - User's Firebase UID
 * @param {string} openId - TikTok open_id to remove
 * @returns {Promise<Object>} - The updated user
 */
const removeTikTokAccount = async (uid, openId) => {
  if (!uid || !openId) {
    throw new Error('User ID and TikTok open_id are required');
  }
  
  try {
    // First get the user to check current TikTok accounts
    const user = await User.findOne({ uid });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Get current TikTok accounts
    const tiktokAccounts = user?.providerData?.get('tiktok') || [];
    
    // If no TikTok accounts, nothing to remove
    if (!Array.isArray(tiktokAccounts) || tiktokAccounts.length === 0) {
      return user;
    }
    
    console.log('Current TikTok accounts:', JSON.stringify(tiktokAccounts, null, 2));
    console.log('Removing account with openId:', openId);
    
    // Filter out the account to remove
    const updatedAccounts = tiktokAccounts.filter(account => account?.openId !== openId);
    
    // Reindex remaining accounts
    const reindexedAccounts = updatedAccounts.map((account, idx) => ({
      ...account,
      index: idx + 1
    }));
    
    console.log('Filtered and reindexed accounts:', JSON.stringify(reindexedAccounts, null, 2));
    
    // Update the user with filtered accounts
    const updateQuery = {};
    updateQuery['providerData.tiktok'] = reindexedAccounts.length > 0 ? reindexedAccounts : null;
    
    // If there are no more accounts, unset the field, otherwise update with remaining accounts
    const operation = reindexedAccounts.length > 0 ? { $set: updateQuery } : { $unset: { 'providerData.tiktok': 1 } };
    
    const updatedUser = await User.findOneAndUpdate(
      { uid },
      operation,
      { new: true, runValidators: true }
    );
    
    return updatedUser;
  } catch (error) {
    console.error(`Error removing TikTok account for user ${uid}:`, error);
    throw error;
  }
};

/**
 * Remove a specific Twitter account from user's Twitter connections
 * @param {string} uid - User's Firebase UID
 * @param {string} userId - Twitter user_id to remove
 * @returns {Promise<Object>} - The updated user
 */
const removeTwitterAccount = async (uid, userId) => {
  if (!uid || !userId) {
    throw new Error('User ID and Twitter user_id are required');
  }
  
  try {
    // First get the user to check current Twitter accounts
    const user = await User.findOne({ uid });
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Get current Twitter accounts
    const twitterAccounts = user?.providerData?.get('twitter') || [];
    
    // If no Twitter accounts, nothing to remove
    if (!Array.isArray(twitterAccounts) || twitterAccounts.length === 0) {
      return user;
    }
    
    console.log('Current Twitter accounts:', JSON.stringify(twitterAccounts, null, 2));
    console.log('Removing account with userId:', userId);
    
    // Filter out the account to remove
    const updatedAccounts = twitterAccounts.filter(account => account?.userId !== userId);
    
    console.log('Filtered accounts:', JSON.stringify(updatedAccounts, null, 2));
    
    // Update the user with filtered accounts
    const updateQuery = {};
    updateQuery['providerData.twitter'] = updatedAccounts.length > 0 ? updatedAccounts : null;
    
    // If there are no more accounts, unset the field, otherwise update with remaining accounts
    const operation = updatedAccounts.length > 0 ? { $set: updateQuery } : { $unset: { 'providerData.twitter': 1 } };
    
    const updatedUser = await User.findOneAndUpdate(
      { uid },
      operation,
      { new: true, runValidators: true }
    );
    
    return updatedUser;
  } catch (error) {
    console.error(`Error removing Twitter account for user ${uid}:`, error);
    throw error;
  }
};

/**
 * Create a new user
 * @param {Object} userData - User data including uid, email, displayName
 * @returns {Promise<Object>} - The created user
 */
const createUser = async (userData) => {
  try {
    const { uid, email, displayName, photoURL } = userData;
    
    // Create basic user with default settings
    const user = new User({
      uid,
      email,
      displayName: displayName || email.split('@')[0],
      photoURL: photoURL || '',
      role: 'Starter',
      createdAt: new Date(),
      lastLogin: new Date()
    });
    
    await user.save();
    return user;
  } catch (error) {
    console.error('Error in createUser:', error);
    throw error;
  }
};

module.exports = {
  createOrUpdateUser,
  getUserByUid,
  updateUserRole,
  isUserPro,
  updateSocialMediaTokens,
  removeSocialMediaConnection,
  removeTikTokAccount,
  removeTwitterAccount,
  createUser
}; 