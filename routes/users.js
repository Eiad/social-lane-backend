const express = require('express');
const router = express.Router();
const User = require('../models/User');
const mongoose = require('mongoose');
// Import auth conditionally to allow testing without it
let auth;
try {
  const authModule = require('../middleware/auth');
  auth = authModule.auth;
} catch (error) {
  console.warn('Auth middleware not loaded. Authentication will be bypassed.');
  // Provide a dummy auth middleware that passes through all requests
  auth = (req, res, next) => next();
}
const userService = require('../services/userService');
const { getAllPlans, getLimit, hasFeature } = require('../utils/roleLimits');

// Get all users (with pagination)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-paymentHistory') // Exclude sensitive data
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments();

    res.status(200).json({
      success: true,
      count: users.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: users
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Get user by Firebase UID
router.get('/:uid', async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.params.uid });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Create a sanitized version of user data without Twitter tokens
    let sanitizedUserData;
    
    if (user.toObject) {
      sanitizedUserData = user.toObject();
    } else {
      sanitizedUserData = JSON.parse(JSON.stringify(user));
    }
    
    // Remove Twitter tokens from response
    if (sanitizedUserData.providerData && sanitizedUserData.providerData.twitter) {
      if (Array.isArray(sanitizedUserData.providerData.twitter)) {
        // Filter out sensitive data from each Twitter account
        sanitizedUserData.providerData.twitter = sanitizedUserData.providerData.twitter.map(account => ({
          userId: account.userId,
          username: account.username,
          name: account.name,
          profileImageUrl: account.profileImageUrl
        }));
      } else {
        // If it's a single account object, filter it
        const twitterAccount = sanitizedUserData.providerData.twitter;
        sanitizedUserData.providerData.twitter = {
          userId: twitterAccount.userId,
          username: twitterAccount.username,
          name: twitterAccount.name,
          profileImageUrl: twitterAccount.profileImageUrl
        };
      }
    }
    
    // Sanitize TikTok data (remove sensitive tokens just like Twitter)
    if (sanitizedUserData.providerData && sanitizedUserData.providerData.tiktok) {
      if (Array.isArray(sanitizedUserData.providerData.tiktok)) {
        // Filter out sensitive data from each TikTok account
        sanitizedUserData.providerData.tiktok = sanitizedUserData.providerData.tiktok.map((account, index) => ({
          accountId: account.openId,
          openId: account.openId,
          username: account.username || '',
          displayName: account.displayName || '',
          avatarUrl: account.avatarUrl || '',
          avatarUrl100: account.avatarUrl100 || '',
          index: account.index || (index + 1)
        }));
      } else {
        // If it's a single account object, filter it
        const tiktokAccount = sanitizedUserData.providerData.tiktok;
        sanitizedUserData.providerData.tiktok = {
          accountId: tiktokAccount.openId,
          openId: tiktokAccount.openId,
          username: tiktokAccount.username || '',
          displayName: tiktokAccount.displayName || '',
          avatarUrl: tiktokAccount.avatarUrl || '',
          avatarUrl100: tiktokAccount.avatarUrl100 || '',
          index: tiktokAccount.index || 1
        };
      }
    }

    // Return the sanitized user object
    res.status(200).json({
      success: true,
      data: sanitizedUserData
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Create or update user (upsert)
router.post('/', async (req, res) => {
  try {
    console.log('Creating/updating user, request body:', req.body);
    const { uid, email, displayName, photoURL } = req?.body || {};
    
    // Validate required fields
    if (!uid || !email) {
      console.error('Missing required fields. uid:', uid, 'email:', email);
      return res.status(400).json({
        success: false,
        error: 'UID and email are required'
      });
    }
    
    // Try to find existing user first
    let user = await User.findOne({ uid });
    
    if (user) {
      console.log(`Updating existing user ${uid}`);
      // Update existing user
      user = await User.findOneAndUpdate(
        { uid },
        {
          email,
          ...(displayName && { displayName }),
          ...(photoURL && { photoURL }),
          lastLogin: new Date()
        },
        { new: true, runValidators: true }
      );
    } else {
      console.log(`Creating new user with uid ${uid} and email ${email}`);
      // Create new user
      user = new User({
        uid,
        email,
        displayName: displayName || email?.split('@')?.[0] || 'User',
        photoURL: photoURL || '',
        role: 'Starter',
        createdAt: new Date(),
        lastLogin: new Date()
      });
      
      await user.save();
    }
    
    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error creating/updating user:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Update user role
router.put('/:uid/role', async (req, res) => {
  try {
    const { role } = req.body;

    if (!role || !['Starter', 'Launch', 'Rise', 'Scale'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid role (Starter, Launch, Rise, or Scale)'
      });
    }

    const user = await User.findOneAndUpdate(
      { uid: req.params.uid },
      {
        role,
        ...(role !== 'Starter' && !req.body.keepSubscriptionDates ? {
          subscriptionStartDate: new Date()
        } : {})
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Add payment record
router.post('/:uid/payment', async (req, res) => {
  try {
    const { amount, currency, paymentMethod, transactionId } = req.body;

    if (!amount || !currency || !paymentMethod || !transactionId) {
      return res.status(400).json({
        success: false,
        error: 'Please provide all payment details'
      });
    }

    const user = await User.findOneAndUpdate(
      { uid: req.params.uid },
      {
        $push: {
          paymentHistory: {
            amount,
            currency,
            paymentMethod,
            transactionId,
            date: new Date()
          }
        }
      },
      {
        new: true
      }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error adding payment record:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Delete user
router.delete('/:uid', async (req, res) => {
  try {
    const user = await User.findOneAndDelete({ uid: req.params.uid });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Update user's Twitter tokens
router.post('/:uid/social/twitter', async (req, res) => {
  try {
    const { uid } = req.params;
    // Handle both direct array and accounts object format
    const tokenData = req.body.accounts || req.body;
    
    if (!tokenData || !Array.isArray(tokenData)) {
      return res.status(400).json({
        success: false,
        error: 'Twitter token data should be an array'
      });
    }
    
    console.log(`Processing ${tokenData.length} Twitter accounts for user ${uid}`);
    console.log('Accounts data structure:', JSON.stringify(tokenData.map(acc => ({
      hasAccessToken: !!acc.accessToken,
      hasAccessTokenSecret: !!acc.accessTokenSecret,
      userId: acc.userId,
      username: acc.username
    }))));
    
    const user = await userService.updateSocialMediaTokens(uid, 'twitter', tokenData);
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error updating Twitter tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Remove user's Twitter account
router.delete('/:uid/social/twitter', async (req, res) => {
  try {
    const { uid } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Twitter user_id is required'
      });
    }
    
    // Remove specific Twitter account from user's providerData
    const user = await userService.removeTwitterAccount(uid, userId);
    
    res.status(200).json({
      success: true,
      message: 'Twitter connection removed successfully',
      data: user
    });
  } catch (error) {
    console.error('Error removing Twitter connection:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Update user's TikTok tokens
router.post('/:uid/social/tiktok', async (req, res) => {
  try {
    const { uid } = req.params;
    let tokenData = req.body;
    
    console.log(`[TIKTOK SAVE] Received data for user ${uid}`, JSON.stringify({
      dataType: typeof tokenData,
      isArray: Array.isArray(tokenData),
      dataLength: Array.isArray(tokenData) ? tokenData.length : 'not an array',
      sampleKeys: tokenData ? Object.keys(tokenData).slice(0, 5) : []
    }));
    
    // Ensure tokenData is an array for consistent processing
    if (!Array.isArray(tokenData)) {
      console.log('[TIKTOK SAVE] Converting to array since input is not an array');
      
      // If tokenData has accessToken and openId, treat it as a single account
      if (tokenData?.accessToken && tokenData?.openId) {
        tokenData = [tokenData];
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid TikTok token data format. Expected an array or a single account object.'
        });
      }
    }
    
    // Validate that each item has the required fields
    const validTokens = tokenData.filter(token => token?.accessToken && token?.openId);
    
    if (validTokens.length === 0) {
      console.log('[TIKTOK SAVE] No valid TikTok tokens found in data');
      return res.status(400).json({
        success: false,
        error: 'No valid TikTok accounts found. Each account requires accessToken and openId.'
      });
    }
    
    console.log(`[TIKTOK SAVE] Processing ${validTokens.length} valid TikTok accounts for user ${uid}`);
    
    const user = await userService.updateSocialMediaTokens(uid, 'tiktok', validTokens);
    
    console.log(`[TIKTOK SAVE] Successfully saved TikTok accounts for user ${uid}`);
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error updating TikTok tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Server error: ' + (error?.message || 'Unknown error')
    });
  }
});

// Remove user's TikTok connection
router.delete('/:uid/social/tiktok', async (req, res) => {
  try {
    const { uid } = req.params;
    const { openId } = req.query;
    
    if (!openId) {
      return res.status(400).json({
        success: false,
        error: 'TikTok open_id is required'
      });
    }
    
    // Remove specific TikTok account from user's providerData
    const user = await userService.removeTikTokAccount(uid, openId);
    
    res.status(200).json({
      success: true,
      message: 'TikTok connection removed successfully',
      data: user
    });
  } catch (error) {
    console.error('Error removing TikTok connection:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Get subscription plan details
router.get('/plans', async (req, res) => {
  try {
    // Get all plan details
    const plans = getAllPlans();
    
    res.status(200).json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Error fetching plan details:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Get user limits and features
router.get('/:uid/limits', async (req, res) => {
  try {
    const { uid } = req.params;
    
    // Find the user
    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Get the user's role - default to Starter if not found
    const role = user.role || 'Starter';
    
    // Get limits and features for the user's role
    const limits = {
      socialAccounts: getLimit(role, 'socialAccounts'),
      scheduledPosts: getLimit(role, 'scheduledPosts'),
      hasContentStudio: hasFeature(role, 'contentStudio'),
      hasCarouselPosts: hasFeature(role, 'carouselPosts'),
      growthConsulting: getLimit(role, 'growthConsulting'),
      analyticsLevel: getLimit(role, 'analyticsLevel'),
      teamMembers: getLimit(role, 'teamMembers'),
      role: role
    };
    
    res.status(200).json({
      success: true,
      data: limits
    });
  } catch (error) {
    console.error('Error fetching user limits:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Add this route to store Twitter accounts for a user if it doesn't exist already
router.post('/:userId/social/twitter', async (req, res) => {
  try {
    const { userId } = req.params;
    // Handle various payload formats: direct array or nested in accounts property
    const rawPayload = req.body;
    console.log(`[TWITTER SAVE] Raw payload received for user ${userId}:`, JSON.stringify(rawPayload));
    
    // Inspect the payload in more detail
    let payloadDetails = {};
    if (Array.isArray(rawPayload)) {
      payloadDetails = {
        type: 'array',
        length: rawPayload.length,
        firstItem: rawPayload[0] ? {
          hasAccessToken: !!rawPayload[0].accessToken,
          accessTokenLength: rawPayload[0].accessToken?.length || 0,
          hasAccessTokenSecret: !!rawPayload[0].accessTokenSecret,
          accessTokenSecretLength: rawPayload[0].accessTokenSecret?.length || 0,
          userId: rawPayload[0].userId,
          username: rawPayload[0].username
        } : 'empty'
      };
    } else if (rawPayload.accounts && Array.isArray(rawPayload.accounts)) {
      payloadDetails = {
        type: 'accounts object',
        length: rawPayload.accounts.length,
        firstItem: rawPayload.accounts[0] ? {
          hasAccessToken: !!rawPayload.accounts[0].accessToken,
          accessTokenLength: rawPayload.accounts[0].accessToken?.length || 0,
          hasAccessTokenSecret: !!rawPayload.accounts[0].accessTokenSecret,
          accessTokenSecretLength: rawPayload.accounts[0].accessTokenSecret?.length || 0,
          userId: rawPayload.accounts[0].userId,
          username: rawPayload.accounts[0].username
        } : 'empty'
      };
    } else {
      payloadDetails = {
        type: 'unknown',
        keys: Object.keys(rawPayload)
      };
    }
    
    console.log(`[TWITTER SAVE] Detailed payload inspection:`, payloadDetails);
    
    // Extract accounts from either format
    let twitterAccounts = [];
    if (Array.isArray(rawPayload)) {
      console.log('[TWITTER SAVE] Detected array payload format');
      twitterAccounts = rawPayload;
    } else if (rawPayload.accounts && Array.isArray(rawPayload.accounts)) {
      console.log('[TWITTER SAVE] Detected nested accounts array format');
      twitterAccounts = rawPayload.accounts;
    } else if (rawPayload.accessToken && rawPayload.accessTokenSecret) {
      console.log('[TWITTER SAVE] Detected single account object format');
      twitterAccounts = [rawPayload];
    } else {
      // Try to extract a single account from any properties
      const possibleAccount = Object.values(rawPayload).find(val => 
        val && typeof val === 'object' && val.accessToken && val.accessTokenSecret
      );
      
      if (possibleAccount) {
        console.log('[TWITTER SAVE] Extracted account from nested object');
        twitterAccounts = [possibleAccount];
      } else {
        console.error('[TWITTER SAVE] Invalid or unrecognized payload format');
      }
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    if (!Array.isArray(twitterAccounts) || twitterAccounts.length === 0) {
      return res.status(400).json({ error: 'Twitter accounts array is required' });
    }
    
    console.log(`[TWITTER SAVE] Storing ${twitterAccounts.length} Twitter accounts for user ${userId}`);
    console.log('[TWITTER SAVE] Twitter accounts data:', JSON.stringify(twitterAccounts.map(acc => ({
      hasAccessToken: !!acc.accessToken,
      accessTokenLength: acc.accessToken?.length || 0,
      hasAccessTokenSecret: !!acc.accessTokenSecret,
      accessTokenSecretLength: acc.accessTokenSecret?.length || 0,
      userId: acc.userId,
      username: acc.username || 'unknown'
    }))));
    
    // Try multiple ways to find the user
    console.log(`[TWITTER SAVE] Searching for user with ID: ${userId}`);
    
    // We'll try several fields to find the user
    let user = null;
    
    // 1. Try the uid field (matches Firebase UID)
    user = await User.findOne({ uid: userId });
    if (user) {
      console.log(`[TWITTER SAVE] User found by uid field: ${user._id}`);
    } else {
      // 2. Try the firebaseUid field
      user = await User.findOne({ firebaseUid: userId });
      if (user) {
        console.log(`[TWITTER SAVE] User found by firebaseUid field: ${user._id}`);
      } else {
        // 3. Try by MongoDB _id
        try {
          if (userId.match(/^[0-9a-fA-F]{24}$/)) {
            user = await User.findById(userId);
            if (user) {
              console.log(`[TWITTER SAVE] User found by _id: ${user._id}`);
            }
          }
        } catch (err) {
          console.log(`[TWITTER SAVE] Error finding by _id: ${err.message}`);
        }
      }
    }
    
    // Create new user if not found by any method
    if (!user) {
      console.log(`[TWITTER SAVE] User not found, creating new user with uid/firebaseUid: ${userId}`);
      user = new User({
        uid: userId,
        firebaseUid: userId,
        email: `user-${userId.substring(0, 8)}@example.com`, // Placeholder email
        displayName: `User ${userId.substring(0, 8)}`, // Placeholder name
        createdAt: new Date(),
        lastLogin: new Date(),
        providerData: {},
      });
      
      try {
        await user.save();
        console.log('[TWITTER SAVE] Created new user record');
      } catch (createError) {
        console.error('[TWITTER SAVE] Error creating new user:', createError);
        throw new Error('Failed to create user record: ' + createError.message);
      }
    }
    
    // Prepare Twitter accounts data and validate
    const validatedAccounts = twitterAccounts
      .filter(account => account.accessToken && account.accessTokenSecret && account.userId)
      .map(account => ({
        accessToken: account.accessToken,
        accessTokenSecret: account.accessTokenSecret,
        userId: account.userId,
        username: account.username || '',
        name: account.name || account.username || '',
        profileImageUrl: account.profileImageUrl || ''
      }));
    
    console.log(`[TWITTER SAVE] Validated ${validatedAccounts.length} of ${twitterAccounts.length} accounts`);
    
    if (validatedAccounts.length === 0) {
      console.error('[TWITTER SAVE] No valid Twitter accounts found in payload');
      return res.status(400).json({ error: 'No valid Twitter accounts provided' });
    }
    
    console.log(`[TWITTER SAVE] ${validatedAccounts.length} valid Twitter accounts ready for saving`);
    console.log('[TWITTER SAVE] First validated account:', {
      hasAccessToken: !!validatedAccounts[0].accessToken,
      accessTokenLength: validatedAccounts[0].accessToken?.length || 0,
      hasAccessTokenSecret: !!validatedAccounts[0].accessTokenSecret,
      accessTokenSecretLength: validatedAccounts[0].accessTokenSecret?.length || 0,
      userId: validatedAccounts[0].userId,
      username: validatedAccounts[0].username
    });
    
    // Try multiple DB update methods to ensure the data gets saved
    
    // 1. First try direct MongoDB update for reliability
    try {
      console.log(`[TWITTER SAVE] Performing direct MongoDB update for user ${user._id}`);
      const db = mongoose.connection.db;
      const usersCollection = db.collection('users');
      
      const updateResult = await usersCollection.updateOne(
        { _id: user._id },
        { $set: { 'providerData.twitter': validatedAccounts, lastLogin: new Date() } }
      );
      
      console.log('[TWITTER SAVE] Direct update result:', {
        acknowledged: updateResult.acknowledged,
        modifiedCount: updateResult.modifiedCount,
        matchedCount: updateResult.matchedCount
      });
      
      if (!updateResult.acknowledged || updateResult.matchedCount === 0) {
        console.warn('[TWITTER SAVE] Direct update did not match any documents, trying alternative methods');
        // Continue to try other methods
      } else if (updateResult.modifiedCount === 0) {
        console.warn('[TWITTER SAVE] Direct update matched but did not modify any documents, may need to force update');
        // Continue to try other methods
      } else {
        console.log('[TWITTER SAVE] Direct update successful!');
      }
    } catch (directUpdateError) {
      console.error('[TWITTER SAVE] Error with direct MongoDB update:', directUpdateError);
      // Continue to next method
    }
    
    // 2. Try Mongoose findOneAndUpdate as fallback
    try {
      console.log(`[TWITTER SAVE] Trying Mongoose findOneAndUpdate as fallback`);
      const updateOptions = { new: true, useFindAndModify: false };
      
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { 
          $set: { 
            'providerData.twitter': validatedAccounts,
            lastLogin: new Date()
          }
        },
        updateOptions
      );
      
      if (updatedUser) {
        console.log('[TWITTER SAVE] Mongoose findOneAndUpdate successful');
      } else {
        console.warn('[TWITTER SAVE] Mongoose findOneAndUpdate did not update any document');
      }
    } catch (mongooseUpdateError) {
      console.error('[TWITTER SAVE] Error with Mongoose update:', mongooseUpdateError);
      // Continue to next method
    }
    
    // 3. Try direct document update as last resort
    try {
      console.log(`[TWITTER SAVE] Trying direct document update as last resort`);
      
      // Reload user to get fresh instance
      const freshUser = await User.findById(user._id);
      
      if (freshUser) {
        // Initialize providerData if it doesn't exist
        if (!freshUser.providerData) {
          freshUser.providerData = {};
        }
        
        // Set Twitter accounts
        freshUser.providerData.twitter = validatedAccounts;
        freshUser.lastLogin = new Date();
        
        // Save with error handling
        await freshUser.save();
        console.log('[TWITTER SAVE] Direct document update successful');
      } else {
        console.error('[TWITTER SAVE] Could not find user for direct document update');
      }
    } catch (directDocUpdateError) {
      console.error('[TWITTER SAVE] Error with direct document update:', directDocUpdateError);
    }
    
    // Verify the update with a clean query
    const freshUser = await User.findById(user._id).lean();
    
    let verificationSuccess = false;
    
    if (!freshUser) {
      console.error('[TWITTER SAVE] Failed to verify update - could not find user after updates');
    } else if (!freshUser.providerData) {
      console.error('[TWITTER SAVE] Failed to verify update - user has no providerData field');
    } else if (!freshUser.providerData.twitter) {
      console.error('[TWITTER SAVE] Failed to verify update - user has no twitter field in providerData');
    } else if (!Array.isArray(freshUser.providerData.twitter)) {
      console.error('[TWITTER SAVE] Failed to verify update - twitter field is not an array');
    } else if (freshUser.providerData.twitter.length === 0) {
      console.error('[TWITTER SAVE] Failed to verify update - twitter array is empty');
    } else {
      console.log(`[TWITTER SAVE] Verified ${freshUser.providerData.twitter.length} Twitter accounts saved`);
      console.log('[TWITTER SAVE] First saved account details:', {
        hasAccessToken: !!freshUser.providerData.twitter[0].accessToken,
        accessTokenLength: freshUser.providerData.twitter[0].accessToken?.length || 0,
        hasAccessTokenSecret: !!freshUser.providerData.twitter[0].accessTokenSecret,
        accessTokenSecretLength: freshUser.providerData.twitter[0].accessTokenSecret?.length || 0,
        userId: freshUser.providerData.twitter[0].userId,
        username: freshUser.providerData.twitter[0].username
      });
      verificationSuccess = true;
    }
    
    // If all verification failed, do one more desperate attempt with a more direct approach
    if (!verificationSuccess) {
      try {
        console.log('[TWITTER SAVE] All methods failed verification, attempting one final approach');
        
        // Use direct MongoDB driver to force update
        const db = mongoose.connection.db;
        const usersCollection = db.collection('users');
        
        // Convert ObjectId to string representation if needed
        const userIdForQuery = typeof user._id === 'object' ? user._id : new mongoose.Types.ObjectId(user._id);
        
        // Completely replace the document's providerData field
        const finalResult = await usersCollection.updateOne(
          { _id: userIdForQuery },
          { 
            $set: { 
              'providerData': {
                twitter: validatedAccounts
              }
            }
          }
        );
        
        console.log('[TWITTER SAVE] Final desperate update result:', {
          acknowledged: finalResult.acknowledged,
          modifiedCount: finalResult.modifiedCount,
          matchedCount: finalResult.matchedCount
        });
      } catch (finalError) {
        console.error('[TWITTER SAVE] Even final desperate attempt failed:', finalError);
      }
    }
    
    res.status(200).json({
      success: true,
      message: 'Twitter accounts updated with multiple fallback methods',
      accountCount: validatedAccounts.length,
      verificationSuccess: verificationSuccess
    });
  } catch (error) {
    console.error('[TWITTER SAVE] Error updating Twitter accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Server error: ' + error.message
    });
  }
});

// Fix the DELETE endpoint to properly remove Twitter accounts
router.delete('/:userId/social/twitter/:twitterUserId', async (req, res) => {
  try {
    const { userId, twitterUserId } = req.params;
    
    if (!userId || !twitterUserId) {
      return res.status(400).json({ error: 'User ID and Twitter user ID are required' });
    }
    
    console.log(`[DELETE TWITTER] Removing Twitter account ${twitterUserId} for user ${userId}`);
    
    // Find the user by uid (Firebase UID)
    const user = await User.findOne({ uid: userId });
    
    if (!user) {
      console.error(`[DELETE TWITTER] User not found with uid: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`[DELETE TWITTER] Found user: ${user._id} (uid: ${user.uid})`);
    
    // Check if user has Twitter accounts in providerData
    if (!user.providerData || !user.providerData.twitter || !Array.isArray(user.providerData.twitter) || user.providerData.twitter.length === 0) {
      console.warn(`[DELETE TWITTER] No Twitter accounts found for user ${userId}`);
      return res.status(404).json({ error: 'No Twitter accounts found for this user' });
    }
    
    // Log the Twitter accounts before removal
    console.log(`[DELETE TWITTER] User has ${user.providerData.twitter.length} Twitter accounts before removal`);
    console.log(`[DELETE TWITTER] Provider Data before removal:`, JSON.stringify(user.providerData));
    user.providerData.twitter.forEach((account, index) => {
      console.log(`[DELETE TWITTER] Account ${index + 1}: userId=${account.userId}, username=${account.username}`);
    });
    
    // Find the account to remove
    const accountIndex = user.providerData.twitter.findIndex(account => account.userId === twitterUserId);
    
    if (accountIndex === -1) {
      console.warn(`[DELETE TWITTER] Twitter account ${twitterUserId} not found in user's accounts`);
      return res.status(404).json({ error: 'Twitter account not found for this user' });
    }
    
    console.log(`[DELETE TWITTER] Found Twitter account ${twitterUserId} at index ${accountIndex}`);
    
    // Remove the account
    const removedAccount = user.providerData.twitter.splice(accountIndex, 1)[0];
    console.log(`[DELETE TWITTER] Removed account:`, JSON.stringify(removedAccount));
    
    // If no Twitter accounts left, remove the Twitter array completely
    if (user.providerData.twitter.length === 0) {
      console.log(`[DELETE TWITTER] No Twitter accounts left, removing Twitter array`);
      delete user.providerData.twitter;
    } else {
      console.log(`[DELETE TWITTER] ${user.providerData.twitter.length} Twitter accounts remaining`);
    }
    
    console.log(`[DELETE TWITTER] Provider Data after removal:`, JSON.stringify(user.providerData));
    
    // Save the updated user
    await user.save();
    console.log(`[DELETE TWITTER] User saved successfully after save() call`);
    
    // Double-check the save worked by fetching the user again
    const updatedUser = await User.findOne({ uid: userId });
    console.log(`[DELETE TWITTER] User after refetch:`, updatedUser ? 
      `Has Twitter: ${updatedUser.providerData?.twitter ? 'Yes' : 'No'}` : 'User not found');
    if (updatedUser && updatedUser.providerData?.twitter) {
      console.log(`[DELETE TWITTER] Twitter accounts after refetch:`, 
        JSON.stringify(updatedUser.providerData.twitter));
      
      // If the account is still there after save(), try a different approach with direct MongoDB update
      if (updatedUser.providerData.twitter.some(acc => acc.userId === twitterUserId)) {
        console.log(`[DELETE TWITTER] Account still exists after save, trying direct MongoDB update with $pull`);
        
        // Use findOneAndUpdate with $pull operator for more direct control
        const forcedUpdateResult = await User.findOneAndUpdate(
          { uid: userId },
          { $pull: { 'providerData.twitter': { userId: twitterUserId } } },
          { new: true }
        );
        
        console.log(`[DELETE TWITTER] Forced update result:`, 
          forcedUpdateResult ? `Has Twitter: ${forcedUpdateResult.providerData?.twitter ? 'Yes' : 'No'}` : 'Failed');
        
        if (forcedUpdateResult?.providerData?.twitter?.length === 0) {
          // If array is now empty, remove it completely with $unset
          const finalCleanup = await User.findOneAndUpdate(
            { uid: userId },
            { $unset: { 'providerData.twitter': 1 } },
            { new: true }
          );
          
          console.log(`[DELETE TWITTER] Final cleanup result:`, 
            finalCleanup ? `Has Twitter: ${finalCleanup.providerData?.twitter ? 'Yes' : 'No'}` : 'Failed');
        }
      }
    }
    
    res.status(200).json({
      message: 'Twitter account removed successfully',
      accountCount: user.providerData.twitter ? user.providerData.twitter.length : 0
    });
  } catch (error) {
    console.error('[DELETE TWITTER] Error removing Twitter account:', error);
    res.status(500).json({ error: 'Failed to remove Twitter account: ' + error.message });
  }
});

// Temporary debug endpoint to check user data
router.get('/:userId/debug', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`[DEBUG] Checking user data for: ${userId}`);
    
    // Check if it's a valid ObjectId
    const isValidObjectId = userId.match(/^[0-9a-fA-F]{24}$/);
    console.log(`[DEBUG] Is valid ObjectId: ${isValidObjectId ? 'Yes' : 'No'}`);
    
    // Try to find by uid
    const userByUid = await User.findOne({ uid: userId });
    console.log(`[DEBUG] User found by uid: ${userByUid ? 'Yes' : 'No'}`);
    
    // Try to find by _id if it's a valid ObjectId
    let userById = null;
    if (isValidObjectId) {
      try {
        userById = await User.findById(userId);
        console.log(`[DEBUG] User found by _id: ${userById ? 'Yes' : 'No'}`);
      } catch (idError) {
        console.log(`[DEBUG] Error finding by _id: ${idError.message}`);
      }
    }
    
    // If found by uid, check the user structure
    let uidUserDetails = null;
    if (userByUid) {
      uidUserDetails = {
        _id: userByUid._id.toString(),
        uid: userByUid.uid,
        email: userByUid.email,
        hasProviderData: !!userByUid.providerData,
        twitterAccounts: userByUid.providerData && userByUid.providerData.twitter ? userByUid.providerData.twitter.length : 0,
        twitterAccountDetails: userByUid.providerData && userByUid.providerData.twitter ? 
          userByUid.providerData.twitter.map(acc => ({
            userId: acc.userId,
            username: acc.username
          })) : []
      };
    }
    
    // If found by _id, check the user structure
    let idUserDetails = null;
    if (userById) {
      idUserDetails = {
        _id: userById._id.toString(),
        uid: userById.uid,
        email: userById.email,
        hasProviderData: !!userById.providerData,
        twitterAccounts: userById.providerData && userById.providerData.twitter ? userById.providerData.twitter.length : 0,
        twitterAccountDetails: userById.providerData && userById.providerData.twitter ? 
          userById.providerData.twitter.map(acc => ({
            userId: acc.userId,
            username: acc.username
          })) : []
      };
    }
    
    // Check all users
    const allUsers = await User.find({}).select('uid email');
    const userIds = allUsers.map(u => ({
      _id: u._id.toString(),
      uid: u.uid,
      email: u.email
    }));
    
    // Return results
    res.status(200).json({
      message: 'Debug information',
      userId,
      foundByUid: !!userByUid,
      foundById: !!userById,
      userByUid: uidUserDetails,
      userById: idUserDetails,
      allUsers: userIds
    });
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    res.status(500).json({ error: 'Debug error: ' + error.message });
  }
});

// Temporary debug endpoint to clear cache and get fresh user data
router.get('/:userId/refresh', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    console.log(`[REFRESH] Refreshing user data for ${userId}`);
    
    // Find the user by uid (Firebase UID) with lean() to get a plain JS object and bypass cache
    const user = await User.findOne({ uid: userId }).lean();
    
    if (!user) {
      console.error(`[REFRESH] User not found with uid: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Also try using findById with lean() to get fresh data
    const userById = user._id ? await User.findById(user._id).lean() : null;
    
    // Log cache info
    console.log(`[REFRESH] User cache info:`, {
      userFound: !!user,
      userByIdFound: !!userById,
      hasProviderData: !!user?.providerData,
      hasTwitter: !!user?.providerData?.twitter,
      twitterAccountCount: user?.providerData?.twitter?.length || 0
    });
    
    // Force a DB operation to clear any potential cache
    const updateResult = await User.updateOne(
      { _id: user._id },
      { $set: { lastRefreshed: new Date() } }
    );
    
    // Get a completely fresh copy after the update
    const freshUser = await User.findById(user._id).lean();
    
    res.status(200).json({
      success: true,
      cacheInfo: {
        updateResult: {
          acknowledged: updateResult.acknowledged,
          modifiedCount: updateResult.modifiedCount
        },
        originalUserHasTwitter: user?.providerData?.twitter ? true : false,
        freshUserHasTwitter: freshUser?.providerData?.twitter ? true : false,
        originalTwitterAccounts: user?.providerData?.twitter || [],
        freshTwitterAccounts: freshUser?.providerData?.twitter || []
      },
      data: freshUser
    });
  } catch (error) {
    console.error('[REFRESH] Error refreshing user data:', error);
    res.status(500).json({ error: 'Failed to refresh user data: ' + error.message });
  }
});

// Direct MongoDB update endpoint for debugging
router.post('/:userId/force-update', async (req, res) => {
  try {
    const { userId } = req.params;
    const update = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    console.log(`[FORCE UPDATE] Directly updating user ${userId} with:`, JSON.stringify(update));
    
    // Try to find the user first
    const user = await User.findOne({ uid: userId });
    
    if (!user) {
      console.error(`[FORCE UPDATE] User not found with uid: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`[FORCE UPDATE] Found user: ${user._id} (uid: ${user.uid})`);
    
    // Use direct MongoDB driver operation to bypass Mongoose caching
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    const result = await usersCollection.updateOne(
      { _id: user._id },
      { $set: update }
    );
    
    console.log(`[FORCE UPDATE] Update result:`, result);
    
    // Get fresh user data after update
    const freshUser = await User.findById(user._id).lean();
    
    res.status(200).json({
      success: true,
      updateResult: {
        acknowledged: result.acknowledged,
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount
      },
      message: 'User updated directly via MongoDB',
      data: freshUser
    });
  } catch (error) {
    console.error('[FORCE UPDATE] Error in direct update:', error);
    res.status(500).json({ error: 'Failed to update user: ' + error.message });
  }
});

// Verify user's TikTok accounts
router.post('/:uid/social/tiktok/verify', async (req, res) => {
  try {
    const { uid } = req.params;
    let accountIds = req.body;
    
    console.log(`[TIKTOK VERIFY] Received verification request for user ${uid}`, JSON.stringify({
      dataType: typeof accountIds,
      isArray: Array.isArray(accountIds),
      dataLength: Array.isArray(accountIds) ? accountIds.length : 'not an array',
      sampleKeys: accountIds ? Object.keys(accountIds).slice(0, 5) : []
    }));
    
    // Ensure accountIds is an array for consistent processing
    if (!Array.isArray(accountIds)) {
      console.log('[TIKTOK VERIFY] Converting to array since input is not an array');
      
      // If accountIds has accountId, treat it as a single account
      if (accountIds?.accountId) {
        accountIds = [accountIds];
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid account ID format. Expected an array or a single account object.'
        });
      }
    }
    
    // Validate that each item has the required fields
    const validAccountIds = accountIds.filter(account => account?.accountId);
    
    if (validAccountIds.length === 0) {
      console.log('[TIKTOK VERIFY] No valid TikTok account IDs found in data');
      return res.status(400).json({
        success: false,
        error: 'No valid TikTok account IDs found. Each account requires accountId.'
      });
    }
    
    console.log(`[TIKTOK VERIFY] Verifying ${validAccountIds.length} TikTok accounts for user ${uid}`);
    
    // Get the user's TikTok accounts
    const tiktokAccounts = await userService.getSocialMediaTokens(uid, 'tiktok');
    
    if (!tiktokAccounts || !Array.isArray(tiktokAccounts) || tiktokAccounts.length === 0) {
      console.log('[TIKTOK VERIFY] No TikTok accounts found for user');
      return res.status(404).json({
        success: false,
        error: 'No TikTok accounts found for user'
      });
    }
    
    console.log(`[TIKTOK VERIFY] User has ${tiktokAccounts.length} TikTok accounts in database`);
    
    // Verify each account ID exists in user's accounts
    const verificationResults = validAccountIds.map(accountToVerify => {
      const foundAccount = tiktokAccounts.find(dbAccount => 
        dbAccount.openId === accountToVerify.accountId
      );
      
      return {
        accountId: accountToVerify.accountId,
        exists: !!foundAccount,
        status: foundAccount ? 'verified' : 'not_found'
      };
    });
    
    console.log(`[TIKTOK VERIFY] Verification results:`, verificationResults.map(r => `${r.accountId}: ${r.status}`).join(', '));
    
    const verifiedCount = verificationResults.filter(r => r.exists).length;
    
    res.status(200).json({
      success: true,
      message: `Verified ${verifiedCount} out of ${validAccountIds.length} accounts`,
      results: verificationResults
    });
  } catch (error) {
    console.error('Error verifying TikTok accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

module.exports = router; 