// File: services/userService.js
const User = require('../models/User');
const { hasReachedLimit, getLimit } = require('../utils/roleLimits'); // Import limit utils
const userService = require('./userService');

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
          createdAt: new Date(),
          providerData: {} // Ensure providerData is initialized
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
 * Get a user's social media tokens for a specific platform
 * @param {string} uid - Firebase UID
 * @param {string} platform - Social media platform (e.g., 'twitter', 'tiktok')
 * @returns {Promise<Array|Object|null>} - The tokens for the specified platform or null if not found
 */
const getSocialMediaTokens = async (uid, platform) => {
  try {
    console.log(`[USER SERVICE] Getting ${platform} tokens for user ${uid}`);

    // Get the user
    const user = await User.findOne({ uid });
    if (!user) {
      console.warn(`[USER SERVICE] User not found with UID: ${uid}`);
      return null;
    }

    // Check if the user has provider data for the requested platform
    if (!user.providerData || !user.providerData[platform]) {
      console.warn(`[USER SERVICE] No ${platform} provider data found for user ${uid}`);
      return null;
    }

    console.log(`[USER SERVICE] Found ${platform} tokens for user ${uid}`);
    return user.providerData[platform];
  } catch (error) {
    console.error(`[USER SERVICE] Error getting ${platform} tokens for user ${uid}:`, error);
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
 * Check if a user has Pro privileges (legacy - should check specific roles now)
 * @param {string} uid - Firebase UID
 * @returns {Promise<boolean>} - True if user has Pro role, false otherwise
 */
const isUserPro = async (uid) => {
  try {
    const user = await User.findOne({ uid });
    // Adjust this logic based on which roles count as "Pro" or have certain features
    return ['Launch', 'Rise', 'Scale'].includes(user?.role);
  } catch (error) {
    console.error('Error in isUserPro:', error);
    return false;
  }
};

/**
 * Update user's social media tokens for a specific provider.
 * Handles merging/adding multiple accounts correctly, especially for TikTok.
 * @param {string} uid - User's Firebase UID
 * @param {string} provider - Social media provider (e.g., 'twitter', 'tiktok')
 * @param {Array|Object} tokenData - Token data to store. Should be an array for multi-account providers like TikTok/Twitter.
 * @returns {Promise<Object>} - The updated user document.
 */
const updateSocialMediaTokens = async (uid, provider, tokenData) => {
  if (!uid || !provider || !tokenData) {
    throw new Error('User ID, provider, and token data are required');
  }

  console.log(`[USER SERVICE] Updating ${provider} tokens for user ${uid}. Received data type: ${typeof tokenData}, isArray: ${Array.isArray(tokenData)}`);

  // Ensure tokenData is always an array for consistent processing
  const accountsToProcess = Array.isArray(tokenData) ? tokenData : [tokenData];

  if (accountsToProcess.length === 0) {
    console.warn(`[USER SERVICE] No valid accounts provided for ${provider} update.`);
    // Still fetch user to return current state
    return await User.findOne({ uid });
  }

  console.log(`[USER SERVICE] Processing ${accountsToProcess.length} ${provider} account(s)`);

  try {
    // Find user first to check limits BEFORE making changes
    let user = await User.findOne({ uid });
    if (!user) {
      // Create user if not exists - handle the case where this is the first interaction
      console.log(`[USER SERVICE] User ${uid} not found, creating new user.`);
      user = new User({
        uid,
        email: `user-${uid.substring(0, 8)}@example.com`, 
        displayName: `User ${uid.substring(0, 8)}`,
        providerData: {}
      });
      // Initial save is needed before we can add provider data
      await user.save(); 
      console.log(`[USER SERVICE] New user ${uid} created.`);
      // Re-fetch to ensure we have the Mongoose object
      user = await User.findOne({ uid }); 
    }

    // Ensure providerData exists
    if (!user.providerData) {
      user.providerData = {};
    }
    // Ensure the specific provider array exists
    if (!user.providerData[provider] || !Array.isArray(user.providerData[provider])) {
      user.providerData[provider] = [];
    }

    const userRole = user.role || 'Starter';
    const accountLimit = getLimit(userRole, 'socialAccounts');

    const existingAccounts = user.providerData[provider];
    const otherProvider = provider === 'tiktok' ? 'twitter' : 'tiktok';
    const existingOtherAccounts = user.providerData[otherProvider] || [];
    
    let currentTotalAccounts = existingAccounts.length + (Array.isArray(existingOtherAccounts) ? existingOtherAccounts.length : (existingOtherAccounts ? 1 : 0));
    
    const accountMap = new Map(existingAccounts.map(acc => [acc.openId || acc.userId, acc]));
    let addedCount = 0;

    for (const newAccount of accountsToProcess) {
      const accountId = newAccount.openId || newAccount.userId; // Identifier
      if (!accountId) {
        console.warn(`[USER SERVICE] Skipping account for provider ${provider} due to missing ID:`, newAccount);
        continue; // Use continue instead of return to process other accounts
      }

      // Basic validation for required tokens
      if (provider === 'tiktok' && (!newAccount.accessToken || !newAccount.openId)) {
         console.warn(`[USER SERVICE] Skipping TikTok account ${accountId}: Missing accessToken or openId.`);
         continue;
      }
       if (provider === 'twitter' && (!newAccount.accessToken || !newAccount.accessTokenSecret || !newAccount.userId)) {
         console.warn(`[USER SERVICE] Skipping Twitter account ${accountId}: Missing required tokens or userId.`);
         continue;
       }

      if (accountMap.has(accountId)) {
        // Update existing account - doesn't count towards limit check here
        console.log(`[USER SERVICE] Updating existing ${provider} account: ${accountId}`);
        const existingAccount = accountMap.get(accountId);
        Object.assign(existingAccount, newAccount, { tokensUpdatedAt: new Date() });
        accountMap.set(accountId, existingAccount); // Ensure map is updated
      } else {
        // Check limit BEFORE adding a NEW account
        if (accountLimit !== -1 && currentTotalAccounts >= accountLimit) {
           console.warn(`[USER SERVICE] Account limit reached for user ${uid} (${userRole}). Limit: ${accountLimit}, Current: ${currentTotalAccounts}. Cannot add new ${provider} account ${accountId}.`);
           // Optionally throw an error or return a specific status
           throw new Error(`Account limit reached (${accountLimit}). Cannot add new ${provider} account.`);
        }
        
        // Add new account
        console.log(`[USER SERVICE] Adding new ${provider} account: ${accountId}`);
        const accountToAdd = {
            ...(provider === 'tiktok' ? { openId: accountId } : { userId: accountId }),
            ...newAccount,
            tokensUpdatedAt: new Date()
        };
        accountMap.set(accountId, accountToAdd);
        currentTotalAccounts++; // Increment count after deciding to add
        addedCount++;
      }
    } // End of forEach loop

    // Convert map back to array and update the user document
    user.providerData[provider] = Array.from(accountMap.values());
    user.lastLogin = new Date(); // Update last login time as well

    // Mark the specific path as modified to ensure saving
    user.markModified(`providerData.${provider}`);

    // Save the user with updated tokens
    const updatedUser = await user.save();

    console.log(`[USER SERVICE] Successfully updated ${provider} tokens for user ${uid}. Added ${addedCount} new account(s). Total ${provider} accounts: ${updatedUser.providerData[provider]?.length || 0}`);
    return updatedUser;

  } catch (error) {
    console.error(`[USER SERVICE] Error updating ${provider} tokens for user ${uid}:`, error);
    // Re-throw the specific limit error if it occurred
    if (error.message.startsWith('Account limit reached')) {
        throw error; 
    }
    // Throw a generic error for other issues
    throw new Error(`Failed to update ${provider} accounts: ${error.message}`);
  }
};

/**
 * Updates the access and refresh tokens for a specific TikTok account of a user.
 * @param {string} uid - The Firebase UID of the user.
 * @param {string} openId - The open_id of the TikTok account to update.
 * @param {string} newAccessToken - The new access token.
 * @param {string} newRefreshToken - The new refresh token (optional, might not change).
 * @returns {Promise<boolean>} - True if update was successful, false otherwise.
 */
const updateTikTokTokens = async (uid, openId, newAccessToken, newRefreshToken) => {
  if (!uid || !openId || !newAccessToken) {
    console.error('[USER SERVICE - updateTikTokTokens] Missing required arguments.');
    return false;
  }

  try {
    console.log(`[USER SERVICE] Updating TikTok tokens for user ${uid}, account ${openId}`);

    const user = await User.findOne({ uid });
    if (!user) {
      console.error(`[USER SERVICE] User not found: ${uid}`);
      return false;
    }

    if (!user.providerData?.tiktok || !Array.isArray(user.providerData.tiktok)) {
      console.error(`[USER SERVICE] User ${uid} has no TikTok accounts array.`);
      return false;
    }

    // Find the index of the account to update
    const accountIndex = user.providerData.tiktok.findIndex(acc => acc.openId === openId);

    if (accountIndex === -1) {
      console.error(`[USER SERVICE] TikTok account ${openId} not found for user ${uid}.`);
      return false;
    }

    // Prepare the update object
    const updatePathPrefix = `providerData.tiktok.${accountIndex}`;
    const updateData = {
      [`${updatePathPrefix}.accessToken`]: newAccessToken,
      [`${updatePathPrefix}.tokensUpdatedAt`]: new Date()
    };

    // Only update the refresh token if a new one is provided
    if (newRefreshToken) {
      updateData[`${updatePathPrefix}.refreshToken`] = newRefreshToken;
      console.log('[USER SERVICE] New refresh token provided, updating.');
    } else {
       console.log('[USER SERVICE] No new refresh token provided, keeping the old one.');
    }


    // Update the specific account using positional operator or direct update
    const result = await User.updateOne(
      { uid: uid, 'providerData.tiktok.openId': openId },
      { $set: updateData }
    );

    if (result.modifiedCount === 0 && result.matchedCount === 0) {
        console.error(`[USER SERVICE] Failed to find user/account to update tokens for ${uid}/${openId}`);
        return false;
    }
     if (result.modifiedCount === 0 && result.matchedCount > 0) {
        console.warn(`[USER SERVICE] Found user/account ${uid}/${openId} but tokens were already up-to-date.`);
        // Consider this a success as the tokens are current
        return true;
    }


    console.log(`[USER SERVICE] Successfully updated TikTok tokens for account ${openId} of user ${uid}.`);
    return true;

  } catch (error) {
    console.error(`[USER SERVICE] Error updating TikTok tokens for ${uid}/${openId}:`, error);
    return false;
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
    updateQuery[updatePath] = 1; // Use 1 to signify removal with $unset

    const user = await User.findOneAndUpdate(
      { uid },
      { $unset: updateQuery }, // Use $unset to remove the field
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error('User not found');
    }

    console.log(`[USER SERVICE] Removed ${platform} connection for user ${uid}`);
    return user;
  } catch (error) {
    console.error(`[USER SERVICE] Error removing ${platform} connection for user ${uid}:`, error);
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
    console.log(`[USER SERVICE] Attempting to remove TikTok account ${openId} for user ${uid}`);

    // Use findOneAndUpdate with $pull to remove the specific account
    const updatedUser = await User.findOneAndUpdate(
      { uid },
      { $pull: { 'providerData.tiktok': { openId: openId } } },
      { new: true } // Return the updated document
    );

    if (!updatedUser) {
      console.error(`[USER SERVICE] User not found: ${uid}`);
      throw new Error('User not found');
    }

    // Check if the account was actually removed
    const accountExists = updatedUser.providerData?.tiktok?.some(acc => acc.openId === openId);
    if (accountExists) {
      console.error(`[USER SERVICE] Failed to remove TikTok account ${openId}. It still exists.`);
      // Potentially try another method or log more info
      // For now, we'll rely on the $pull operation
      // Maybe trigger a re-fetch/re-sync?
       const finalUser = await User.findOne({ uid }); // Re-fetch
        if(finalUser?.providerData?.tiktok?.some(acc => acc.openId === openId)) {
            console.error("[USER SERVICE] Account still present after refetch. Manual intervention might be needed.");
        } else {
             console.log("[USER SERVICE] Refetch confirmed account removal.");
        }


    } else {
      console.log(`[USER SERVICE] Successfully removed TikTok account ${openId} for user ${uid}`);
      // Re-index remaining accounts if needed (optional)
      if (updatedUser.providerData?.tiktok && updatedUser.providerData.tiktok.length > 0) {
        updatedUser.providerData.tiktok.forEach((acc, index) => {
          acc.index = index + 1;
        });
        await updatedUser.save();
        console.log(`[USER SERVICE] Re-indexed remaining ${updatedUser.providerData.tiktok.length} TikTok accounts.`);
      }
       // If the array is now empty, remove it completely
        if (updatedUser.providerData?.tiktok?.length === 0) {
            console.log("[USER SERVICE] TikTok accounts array is empty, removing it.");
            await User.updateOne({ uid }, { $unset: { 'providerData.tiktok': 1 } });
        }


    }

    return updatedUser;
  } catch (error) {
    console.error(`[USER SERVICE] Error removing TikTok account ${openId} for user ${uid}:`, error);
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
    console.log(`[USER SERVICE] Removing Twitter account ${userId} for user ${uid}`);

    const updatedUser = await User.findOneAndUpdate(
      { uid },
      { $pull: { 'providerData.twitter': { userId: userId } } },
      { new: true }
    );

    if (!updatedUser) {
      throw new Error('User not found');
    }

     // If the array is now empty, remove it completely
    if (updatedUser.providerData?.twitter?.length === 0) {
        console.log("[USER SERVICE] Twitter accounts array is empty, removing it.");
        await User.updateOne({ uid }, { $unset: { 'providerData.twitter': 1 } });
    }

    console.log(`[USER SERVICE] Successfully removed Twitter account ${userId} for user ${uid}`);
    return updatedUser;
  } catch (error) {
    console.error(`[USER SERVICE] Error removing Twitter account ${userId} for user ${uid}:`, error);
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
      lastLogin: new Date(),
      providerData: {} // Initialize providerData
    });

    await user.save();
    return user;
  } catch (error) {
    console.error('Error in createUser:', error);
    throw error;
  }
};

/**
 * Increment post count for a user and handle cycle reset if needed
 * @param {string} userId - Firebase UID of the user
 * @returns {Promise<Object>} - Object containing success flag, updated post count, and cycle info
 */
const incrementPostCount = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const user = await User.findOne({ uid: userId });
    if (!user) {
      throw new Error('User not found');
    }

    const userRole = user.role || 'Starter';
    const now = new Date();
    let cycleReset = false;
    let postsRemaining = null;

    // Only track posts for Starter plan users
    if (userRole === 'Starter') {
      const cycleDuration = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
      let cycleStartDate = user.cycleStartDate;
      let currentCount = user.postsThisCycle || 0;
      
      // Reset cycle if needed
      if (!cycleStartDate || (now.getTime() - cycleStartDate.getTime() > cycleDuration)) {
        console.log(`[USER SERVICE] Resetting post count for Starter user ${userId}`);
        user.postsThisCycle = 0;
        user.cycleStartDate = now;
        currentCount = 0;
        cycleReset = true;
      }
      
      // Increment post count
      user.postsThisCycle = currentCount + 1;
      console.log(`[USER SERVICE] Incremented post count for user ${userId} to ${user.postsThisCycle}`);
      
      // Get the limit from roleLimits
      const { getLimit } = require('../utils/roleLimits');
      const postLimit = getLimit(userRole, 'numberOfPosts');
      
      // Calculate remaining posts
      postsRemaining = postLimit === -1 ? -1 : Math.max(0, postLimit - user.postsThisCycle);
      
      // Save the updated user document
      await user.save();
      
      return {
        success: true,
        currentPostCount: user.postsThisCycle,
        postsRemaining: postsRemaining,
        cycleStartDate: user.cycleStartDate,
        cycleReset: cycleReset,
        nextResetDate: new Date(user.cycleStartDate.getTime() + cycleDuration)
      };
    }
    
    // For paid plans, we don't track post count
    return {
      success: true,
      currentPostCount: null,
      postsRemaining: -1, // -1 indicates unlimited
      userRole: userRole
    };
  } catch (error) {
    console.error('Error incrementing post count:', error?.message);
    return {
      success: false,
      error: error?.message || 'Failed to increment post count'
    };
  }
};

/**
 * Get the current post usage for a user
 * @param {string} userId - Firebase UID of the user
 * @returns {Promise<Object>} - Object containing post usage information
 */
const getPostUsage = async (userId) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const user = await User.findOne({ uid: userId });
    if (!user) {
      throw new Error('User not found');
    }

    const userRole = user.role || 'Starter';
    const now = new Date();
    
    // Only track posts for Starter plan users
    if (userRole === 'Starter') {
      const cycleDuration = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
      let cycleStartDate = user.cycleStartDate || now;
      let currentCount = user.postsThisCycle || 0;
      
      // Check if cycle needs reset (but don't reset it here, just report)
      const needsReset = !cycleStartDate || (now.getTime() - cycleStartDate.getTime() > cycleDuration);
      
      // Get the limit from roleLimits
      const { getLimit } = require('../utils/roleLimits');
      const postLimit = getLimit(userRole, 'numberOfPosts');
      
      // Calculate remaining posts
      const postsRemaining = postLimit === -1 ? -1 : Math.max(0, postLimit - currentCount);
      
      return {
        success: true,
        currentPostCount: needsReset ? 0 : currentCount,
        postsRemaining: needsReset ? postLimit : postsRemaining,
        limit: postLimit,
        cycleStartDate: needsReset ? now : cycleStartDate,
        nextResetDate: needsReset ? 
          new Date(now.getTime() + cycleDuration) : 
          new Date(cycleStartDate.getTime() + cycleDuration),
        needsCycleReset: needsReset,
        userRole: userRole
      };
    }
    
    // For paid plans
    return {
      success: true,
      currentPostCount: null,
      postsRemaining: -1, // -1 indicates unlimited
      limit: -1,
      userRole: userRole
    };
  } catch (error) {
    console.error('Error getting post usage:', error?.message);
    return {
      success: false,
      error: error?.message || 'Failed to get post usage'
    };
  }
};

module.exports = {
  createOrUpdateUser,
  getUserByUid,
  getSocialMediaTokens,
  updateUserRole,
  isUserPro,
  updateSocialMediaTokens,
  removeSocialMediaConnection,
  removeTikTokAccount,
  removeTwitterAccount,
  createUser,
  updateTikTokTokens,
  incrementPostCount,
  getPostUsage
};