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
      console.error(`[USER SERVICE] User not found with UID: ${uid}`);
      // Create a basic user record if one doesn't exist
      const newUser = new User({
        uid,
        email: `user-${uid.substring(0, 8)}@example.com`, // Placeholder email
        displayName: `User ${uid.substring(0, 8)}`, // Placeholder name
        createdAt: new Date(),
        lastLogin: new Date(),
        providerData: {}
      });
      
      try {
        await newUser.save();
        console.log(`[USER SERVICE] Created new user record for ${uid}`);
        // Continue with the new user
        user = newUser;
      } catch (createError) {
        console.error(`[USER SERVICE] Error creating new user:`, createError);
        throw new Error('Failed to create user record: ' + createError.message);
      }
    }
    
    // Initialize providerData if it doesn't exist
    if (!user.providerData) {
      user.providerData = {};
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
      user.providerData.tiktok = validatedAccounts;
    } 
    // For Twitter, handle multiple accounts
    else if (provider === 'twitter') {
      if (!Array.isArray(tokenData)) {
        console.warn(`[USER SERVICE] Twitter token data is not an array, converting to array`);
        tokenData = [tokenData];
      }
      
      console.log(`[USER SERVICE] Processing ${tokenData.length} Twitter accounts for user ${uid}`);
      
      // Initialize Twitter array if it doesn't exist
      if (!user.providerData.twitter) {
        user.providerData.twitter = [];
      }
      
      // Process each Twitter account
      for (const account of tokenData) {
        // Validate required fields
        if (!account?.accessToken || !account?.accessTokenSecret || !account?.userId) {
          console.log('[USER SERVICE] Skipping invalid Twitter account (missing required fields):', 
            JSON.stringify({
              hasAccessToken: !!account?.accessToken,
              hasAccessTokenSecret: !!account?.accessTokenSecret,
              hasUserId: !!account?.userId
            })
          );
          continue; // Skip invalid accounts
        }
        
        // Check if account already exists (by userId)
        const existingIndex = user.providerData.twitter.findIndex(
          acc => acc?.userId === account?.userId
        );
        
        const twitterAccount = {
          accessToken: account?.accessToken,
          accessTokenSecret: account?.accessTokenSecret,
          userId: account?.userId,
          username: account?.username || '',
          name: account?.name || account?.username || '',
          profileImageUrl: account?.profileImageUrl || ''
        };
        
        console.log(`[USER SERVICE] Processing Twitter account: ${account?.username || account?.userId || 'new account'}`);
        
        if (existingIndex >= 0) {
          // Update existing account
          console.log(`[USER SERVICE] Updating existing Twitter account for ${account?.username || account?.userId}`);
          user.providerData.twitter[existingIndex] = {
            ...user.providerData.twitter[existingIndex],
            ...twitterAccount
          };
        } else {
          // Add new account
          console.log(`[USER SERVICE] Adding new Twitter account for ${account?.username || account?.userId || 'unknown user'}`);
          user.providerData.twitter.push(twitterAccount);
        }
      }
      
      // Try multiple methods to save Twitter accounts
      
      // 1. First try direct MongoDB update for reliability
      try {
        console.log(`[USER SERVICE] Performing direct MongoDB update for user ${user._id}`);
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;
        const usersCollection = db.collection('users');
        
        const updateResult = await usersCollection.updateOne(
          { _id: user._id },
          { $set: { 'providerData.twitter': user.providerData.twitter, lastLogin: new Date() } }
        );
        
        console.log('[USER SERVICE] Direct update result:', {
          acknowledged: updateResult.acknowledged,
          modifiedCount: updateResult.modifiedCount,
          matchedCount: updateResult.matchedCount
        });
        
        if (updateResult.acknowledged && updateResult.modifiedCount > 0) {
          console.log('[USER SERVICE] Direct MongoDB update successful');
          
          // Get the updated user with a fresh query to verify
          const updatedUser = await User.findById(user._id);
          return updatedUser;
        }
      } catch (directUpdateError) {
        console.error('[USER SERVICE] Error with direct MongoDB update:', directUpdateError);
        // Continue to save() method
      }
    } else {
      // For other providers, just store the token data as is
      user.providerData[provider] = tokenData;
    }
    
    // Save the updated user with standard Mongoose method
    try {
      console.log(`[USER SERVICE] Saving user with standard Mongoose method`);
      await user.save();
      console.log(`[USER SERVICE] User saved successfully with social media tokens`);
      
      // Return the updated user
      return user;
    } catch (saveError) {
      console.error(`[USER SERVICE] Error saving user:`, saveError);
      
      // If save fails, try findOneAndUpdate as a fallback
      try {
        console.log(`[USER SERVICE] Trying findOneAndUpdate as fallback after save failure`);
        const updatedUser = await User.findOneAndUpdate(
          { _id: user._id },
          { $set: { [`providerData.${provider}`]: user.providerData[provider] } },
          { new: true }
        );
        
        if (updatedUser) {
          console.log(`[USER SERVICE] Fallback update successful`);
          return updatedUser;
        } else {
          throw new Error('Fallback update returned no document');
        }
      } catch (fallbackError) {
        console.error(`[USER SERVICE] Fallback update also failed:`, fallbackError);
        throw saveError; // Throw original error
      }
    }
  } catch (error) {
    console.error(`[USER SERVICE] Error updating ${provider} tokens for user ${uid}:`, error);
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
    console.log(`[removeTwitterAccount] Starting removal of Twitter account ${userId} for user ${uid}`);
    
    // First get the user
    const user = await User.findOne({ uid });
    
    if (!user) {
      console.error(`[removeTwitterAccount] User not found with uid: ${uid}`);
      throw new Error('User not found');
    }
    
    console.log(`[removeTwitterAccount] Found user: ${user._id}`);
    
    // Check if user has Twitter accounts
    if (!user.providerData || !user.providerData.twitter || !Array.isArray(user.providerData.twitter)) {
      console.log(`[removeTwitterAccount] User has no Twitter accounts`);
      return user;
    }
    
    // Log current Twitter accounts
    console.log(`[removeTwitterAccount] User has ${user.providerData.twitter.length} Twitter accounts before removal`);
    console.log(`[removeTwitterAccount] Looking for Twitter account with userId: ${userId}`);
    
    // Find the account to remove
    const accountIndex = user.providerData.twitter.findIndex(acc => acc.userId === userId);
    
    if (accountIndex === -1) {
      console.log(`[removeTwitterAccount] Twitter account ${userId} not found in user's accounts`);
      return user;
    }
    
    console.log(`[removeTwitterAccount] Found Twitter account at index ${accountIndex}`);
    
    // Remove the account directly using splice
    const removedAccount = user.providerData.twitter.splice(accountIndex, 1)[0];
    console.log(`[removeTwitterAccount] Removed account:`, removedAccount);
    
    // If no Twitter accounts left, remove the Twitter array completely
    if (user.providerData.twitter.length === 0) {
      console.log(`[removeTwitterAccount] No Twitter accounts left, removing Twitter array`);
      delete user.providerData.twitter;
    } else {
      console.log(`[removeTwitterAccount] ${user.providerData.twitter.length} Twitter accounts remaining`);
    }
    
    // Save the updated user
    await user.save();
    console.log(`[removeTwitterAccount] User saved successfully`);
    
    return user;
  } catch (error) {
    console.error(`[removeTwitterAccount] Error removing Twitter account for user ${uid}:`, error);
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