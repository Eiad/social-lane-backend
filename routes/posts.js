const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const { processPost, checkUserLimits } = require('../services/scheduler');
const { hasReachedLimit, getLimit } = require('../utils/roleLimits');
const User = require('../models/User');
const userService = require('../services/userService');

// @route   GET /posts
// @desc    Get all posts
// @access  Public
router.get('/', async (req, res) => {
  try {
    const { isScheduled } = req.query;
    
    // Build filter object
    const filter = {};
    
    // Add isScheduled filter if provided
    if (isScheduled !== undefined) {
      filter.isScheduled = isScheduled === 'true';
    }
    
    const posts = await Post.find(filter).sort({ date: -1 });
    res.json(posts);
  } catch (err) {
    console.error(err?.message);
    res.status(500).send('Server Error');
  }
});

// @route   GET /posts/:id
// @desc    Get post by ID
// @access  Public
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }
    
    res.json(post);
  } catch (err) {
    console.error(err?.message);
    
    if (err?.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Post not found' });
    }
    
    res.status(500).send('Server Error');
  }
});

// @route   GET /posts/user/:userId
// @desc    Get posts by user ID
// @access  Public
router.get('/user/:userId', async (req, res) => {
  try {
    const { isScheduled } = req.query;
    
    // Build filter object
    const filter = { userId: req.params.userId };
    
    // Add isScheduled filter if provided
    if (isScheduled !== undefined) {
      filter.isScheduled = isScheduled === 'true';
    }
    
    const posts = await Post.find(filter).sort({ date: -1 });
    res.json(posts);
  } catch (err) {
    console.error(err?.message);
    res.status(500).send('Server Error');
  }
});

// @route   POST /posts
// @desc    Create a post
// @access  Public (should be Private in production)
router.post('/', async (req, res) => {
  try {
    console.log('Received post creation request:', {
      hasVideoUrl: !!req.body.video_url,
      hasUserId: !!req.body.userId,
      hasPlatforms: !!req.body.platforms,
      isScheduled: !!req.body.isScheduled,
      scheduledDate: req.body.scheduledDate
    });
    
    // Extract data from request
    const { 
      video_url, 
      video_id,
      post_description, 
      platforms, 
      userId, 
      isScheduled, 
      scheduledDate,
      tiktok_access_token,
      tiktok_refresh_token,
      tiktok_accounts,
      twitter_access_token,
      twitter_access_token_secret,
      twitter_refresh_token,
      twitter_accounts
    } = req.body;

    // Validate required fields
    if (!video_url) {
      return res.status(400).json({ 
        success: false,
        error: 'Video URL is required' 
      });
    }

    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: 'User ID is required' 
      });
    }

    // Get user data for role and limits
    const user = await User.findOne({ uid: userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    const userRole = user.role || 'Starter';
    const now = new Date();

    // Use the new centralized method for checking post limits
    // Get post usage information
    const postUsage = await userService.getPostUsage(userId);
    if (!postUsage.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve post usage information'
      });
    }

    // Check if post limit reached
    if (userRole === 'Starter') {
      console.log(`[POSTS ROUTE] Checking post limits for Starter user ${userId}. Current count: ${postUsage.currentPostCount}, Limit: ${postUsage.limit}, Remaining: ${postUsage.postsRemaining}, Needs Reset: ${postUsage.needsCycleReset}`);
      if (postUsage.postsRemaining !== -1 && postUsage.postsRemaining <= 0 && !postUsage.needsCycleReset) {
        console.log(`[POSTS ROUTE] Post limit reached for user ${userId}.`);
        return res.status(403).json({
            success: false,
            error: `You have reached the maximum of ${postUsage.limit} posts for the free Starter plan this cycle. Your limit resets on ${new Date(postUsage.nextResetDate).toLocaleDateString()}.`,
            limit: postUsage.limit,
            current: postUsage.currentPostCount,
            nextReset: postUsage.nextResetDate
        });
      }
    }

    // Check social accounts limit based on ACCOUNTS SELECTED FOR THIS POST
    const selectedTiktokCount = Array.isArray(req.body.tiktok_accounts) ? req.body.tiktok_accounts.length : 0;
    const selectedTwitterCount = Array.isArray(req.body.twitter_accounts) ? req.body.twitter_accounts.length : 0;
    const totalSelectedAccounts = selectedTiktokCount + selectedTwitterCount;

    console.log(`[POSTS ROUTE] Checking social account limit for ${userRole} user. Limit: ${getLimit(userRole, 'socialAccounts')}, Selected for this post: ${totalSelectedAccounts}`);

    if (totalSelectedAccounts > 0 && hasReachedLimit(userRole, 'socialAccounts', totalSelectedAccounts)) {
        const accountLimit = getLimit(userRole, 'socialAccounts');
        console.error(`[POSTS ROUTE] Social account limit reached. User attempted to post to ${totalSelectedAccounts} accounts, but limit is ${accountLimit}.`);
        return res.status(403).json({
            success: false,
            error: `Your ${userRole} plan allows posting to ${accountLimit} social account(s) at a time. You tried to post to ${totalSelectedAccounts}. Please upgrade or select fewer accounts.`, // Updated error message
            limit: accountLimit,
            selected: totalSelectedAccounts
        });
    }

    // Increment post count for Starter plan users BEFORE saving post
    if (userRole === 'Starter') {
      console.log(`[POSTS ROUTE] Incrementing post count for Starter user ${userId} before saving.`);
      const incrementResult = await userService.incrementPostCount(userId);
      if (!incrementResult.success) {
        console.error('[POSTS ROUTE] Failed to increment post count:', incrementResult.error);
        // Do NOT proceed if increment fails, as it means quota might be full or error occurred
        return res.status(500).json({
            success: false,
            error: 'Failed to update post count. Please try again.',
            details: incrementResult.error
        });
      } else {
         console.log(`[POSTS ROUTE] Post count incremented. New count: ${incrementResult.currentPostCount}`);
      }
    }

    // Create post object with basic info
    let postData = {
      video_url,
      userId,
      isScheduled: !!isScheduled
    };
    
    // Add optional fields if they exist
    if (video_id) postData.video_id = video_id;
    if (post_description) postData.post_description = post_description;
    
    // Set scheduled date if provided
    if (isScheduled && scheduledDate) {
      postData.scheduledDate = scheduledDate;
    }
    
    // Handle platforms array or string
    if (platforms) {
      if (Array.isArray(platforms)) {
        postData.platforms = platforms;
      } else if (typeof platforms === 'string') {
        postData.platforms = [platforms];
      } else if (typeof platforms === 'object') {
        // Extract platform names from object keys
        postData.platforms = Object.keys(platforms);
      }
    } else {
      // Use empty array if no platforms provided
      postData.platforms = [];
    }

    // Handle TikTok accounts
    if (tiktok_accounts && Array.isArray(tiktok_accounts) && tiktok_accounts.length > 0) {
      // Check if we need to fetch token information from the database
      const needsDatabaseLookup = tiktok_accounts.some(account => 
        !account.accessToken || !account.openId
      );
      
      if (needsDatabaseLookup && userId) {
        console.log('TikTok accounts missing token information, fetching from database for user:', userId);
        try {
          // Get user's TikTok accounts from database
          const dbTiktokAccounts = await userService.getSocialMediaTokens(userId, 'tiktok');
          
          if (dbTiktokAccounts && Array.isArray(dbTiktokAccounts) && dbTiktokAccounts.length > 0) {
            console.log(`Found ${dbTiktokAccounts.length} TikTok accounts in database`);
            
            // Map accounts with tokens from database based on username, displayName, or accountId
            postData.tiktok_accounts = tiktok_accounts.map(account => {
              // Look for matching account in database
              const dbAccount = dbTiktokAccounts.find(
                dbAcc => (account.accountId && dbAcc.openId === account.accountId) || 
                        (account.username && dbAcc.username === account.username) ||
                        (account.displayName && (dbAcc.displayName === account.displayName || 
                                               dbAcc.username === account.displayName))
              );
              
              if (!dbAccount) {
                console.warn(`No matching database account found for TikTok account: ${account.username || account.displayName || account.accountId}`);
                return null;
              }
              
              console.log(`Found database tokens for TikTok account: ${dbAccount.username || dbAccount.openId}`);
              
              // Return account with tokens from database
              return {
                accessToken: dbAccount.accessToken,
                refreshToken: dbAccount.refreshToken || null,
                openId: dbAccount.openId,
                username: account.username || dbAccount.username || '',
                displayName: account.displayName || dbAccount.displayName || ''
              };
            }).filter(Boolean); // Remove null entries (accounts not found in database)
            
            console.log(`Successfully matched ${postData.tiktok_accounts.length}/${tiktok_accounts.length} TikTok accounts with database tokens`);
          } else {
            console.warn('No TikTok accounts found in database for user:', userId);
            // Make original mapping as fallback
            postData.tiktok_accounts = tiktok_accounts.map(account => ({
              accessToken: account?.accessToken,
              refreshToken: account?.refreshToken || null,
              openId: account?.openId,
              username: account?.username || '',
              displayName: account?.displayName || ''
            }));
          }
        } catch (error) {
          console.error('Error fetching TikTok tokens from database:', error);
          // Make original mapping as fallback
          postData.tiktok_accounts = tiktok_accounts.map(account => ({
            accessToken: account?.accessToken,
            refreshToken: account?.refreshToken || null,
            openId: account?.openId,
            username: account?.username || '',
            displayName: account?.displayName || ''
          }));
        }
      } else {
        // No database lookup needed, use account data as provided
        postData.tiktok_accounts = tiktok_accounts.map(account => ({
          accessToken: account?.accessToken,
          refreshToken: account?.refreshToken || null,
          openId: account?.openId,
          username: account?.username || '',
          displayName: account?.displayName || ''
        }));
      }
      
      console.log('Formatted TikTok accounts for database:', 
        postData.tiktok_accounts.map(acc => ({
          openId: acc?.openId,
          hasAccessToken: !!acc?.accessToken,
          hasRefreshToken: !!acc?.refreshToken,
          username: acc?.username || ''
        }))
      );
    } else if (tiktok_access_token) {
      // Fallback to single account for backward compatibility
      postData.tiktok_access_token = tiktok_access_token;
      if (tiktok_refresh_token) postData.tiktok_refresh_token = tiktok_refresh_token;
    }
    
    // Add Twitter token fields if they exist
    if (twitter_access_token) postData.twitter_access_token = twitter_access_token;
    if (twitter_access_token_secret) postData.twitter_access_token_secret = twitter_access_token_secret;
    if (twitter_refresh_token) postData.twitter_refresh_token = twitter_refresh_token;
    
    // Handle Twitter accounts array
    if (twitter_accounts && Array.isArray(twitter_accounts) && twitter_accounts.length > 0) {
      // Check if we need to fetch token information from the database
      const needsDatabaseLookup = twitter_accounts.some(account => 
        !account.accessToken || 
        !account.accessTokenSecret || 
        account.accessToken === 'placeholder_to_be_replaced_from_db' || 
        account.accessTokenSecret === 'placeholder_to_be_replaced_from_db'
      );
      
      if (needsDatabaseLookup && userId) {
        console.log('Twitter accounts missing token information or using placeholders, fetching from database for user:', userId);
        try {
          // Get user's Twitter accounts from database
          const dbTwitterAccounts = await userService.getSocialMediaTokens(userId, 'twitter');
          
          if (dbTwitterAccounts && Array.isArray(dbTwitterAccounts) && dbTwitterAccounts.length > 0) {
            console.log(`Found ${dbTwitterAccounts.length} Twitter accounts in database`);
            
            // Map accounts with tokens from database based on userId or username
            postData.twitter_accounts = twitter_accounts.map(account => {
              // Look for matching account in database
              const dbAccount = dbTwitterAccounts.find(
                dbAcc => (account.userId && (dbAcc.userId === account.userId || dbAcc.user_id === account.userId)) || 
                        (account.username && dbAcc.username === account.username)
              );
              
              if (!dbAccount) {
                console.warn(`No matching database account found for Twitter account: ${account.username || account.userId}`);
                return account; // Keep the original account data as fallback
              }
              
              console.log(`Found database tokens for Twitter account: ${dbAccount.username || dbAccount.userId || dbAccount.user_id}`);
              
              // Return account with tokens from database
              return {
                userId: account.userId || dbAccount.userId || dbAccount.user_id,
                username: account.username || dbAccount.username || '',
                accessToken: dbAccount.accessToken,
                accessTokenSecret: dbAccount.accessTokenSecret
              };
            });
            
            console.log(`Successfully matched Twitter accounts with database tokens:`, 
              postData.twitter_accounts.map(acc => ({
                userId: acc.userId,
                username: acc.username,
                hasAccessToken: !!acc.accessToken,
                hasAccessTokenSecret: !!acc.accessTokenSecret
              }))
            );
          } else {
            console.warn('No Twitter accounts found in database for user:', userId);
            // Store the accounts as provided
            postData.twitter_accounts = twitter_accounts;
          }
        } catch (error) {
          console.error('Error fetching Twitter tokens from database:', error);
          // Store the accounts as provided
          postData.twitter_accounts = twitter_accounts;
        }
      } else {
        // No database lookup needed, use account data as provided
        postData.twitter_accounts = twitter_accounts;
      }
    }
    
    // Set status based on whether it's scheduled
    postData.status = isScheduled ? 'pending' : 'processing'; // Initial status

    // Create and save the post
    console.log('Saving post to database...');
    const newPost = new Post(postData);
    const post = await newPost.save();
    
    // Debug: Check if the saved post has the TikTok accounts
    const savedPost = await Post.findById(post._id).lean();
    if (tiktok_accounts && Array.isArray(tiktok_accounts) && tiktok_accounts.length > 0) {
      console.log('Saved post TikTok accounts count:', savedPost.tiktok_accounts?.length || 0);
    }
    
    // If not scheduled, process post immediately asynchronously
    if (!isScheduled) {
      console.log('Triggering immediate post processing asynchronously for post ID:', post._id);
      // Don't await - let the request return while processing happens
      processPost(post).catch(error => {
          console.error(`[ASYNC PROCESS ERROR] Error processing immediate post ${post._id}:`, error);
          // Optionally update post status to failed here if needed, though processPost should handle its own errors
          Post.findByIdAndUpdate(post._id, { $set: { status: 'failed', processing_error: error.message || 'Async processing failed' } }).catch(err => console.error("Failed to update post status after async error:", err));
      });
      
      // Return success response indicating processing has started
      res.status(201).json({
        success: true,
        data: {
          _id: post._id,
          status: 'processing' // Indicate backend processing started
        },
        message: 'Post received and processing started in background'
      });
    } else {
      // For scheduled posts, just return the created post
      console.log('Post scheduled for later processing at:', scheduledDate);
      res.status(201).json({
        success: true,
        data: post, // Return full post data for scheduled items
        message: 'Post scheduled successfully'
      });
    }
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Server error'
    });
  }
});

// @route   PUT /posts/:id
// @desc    Update a post
// @access  Public (should be Private in production)
router.put('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }
    
    // Update fields
    const updateFields = {};
    const allowedFields = [
      'video_url', 
      'video_id', 
      'post_description', 
      'platforms', 
      'isScheduled', 
      'scheduledDate', 
      'status',
      'tiktok_access_token',
      'tiktok_refresh_token',
      'twitter_access_token',
      'twitter_access_token_secret'
    ];
    
    // Only update fields that are provided
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateFields[field] = req.body[field];
      }
    });
    
    // Update the post
    const updatedPost = await Post.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );
    
    res.json(updatedPost);
  } catch (err) {
    console.error(err?.message);
    
    if (err?.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Post not found' });
    }
    
    res.status(500).send('Server Error');
  }
});

// @route   DELETE /posts/:id
// @desc    Delete a post
// @access  Public (should be Private in production)
router.delete('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ msg: 'Post not found' });
    }
    
    await post.deleteOne();
    res.json({ msg: 'Post removed' });
  } catch (err) {
    console.error(err?.message);
    
    if (err?.kind === 'ObjectId') {
      return res.status(404).json({ msg: 'Post not found' });
    }
    
    res.status(500).send('Server Error');
  }
});

// @route   POST /posts/test-scheduler/:id
// @desc    Test the scheduler by processing a specific post
// @access  Public (should be Private in production)
router.post('/test-scheduler/:id', async (req, res) => {
  try {
    const postId = req.params.id;
    if (!postId) {
      return res.status(400).json({ error: 'Post ID is required' });
    }
    
    console.log(`Testing scheduler for post ID: ${postId}`);
    
    // Get the post
    const post = await Post.findById(postId).lean();
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    // Log post details
    console.log('Post details:', {
      id: post._id,
      platforms: post.platforms,
      has_tiktok_accounts: !!post.tiktok_accounts,
      tiktok_accounts_count: post.tiktok_accounts?.length || 0,
      has_legacy_tiktok: !!post.tiktok_access_token,
      has_twitter: !!post.twitter_access_token
    });
    
    if (post.tiktok_accounts) {
      console.log('TikTok accounts in post:', 
        post.tiktok_accounts.map(acc => ({
          openId: acc.openId,
          hasAccessToken: !!acc.accessToken,
          hasRefreshToken: !!acc.refreshToken
        }))
      );
    }
    
    // Import the scheduler
    const { processPost } = require('../services/scheduler');
    
    // Process the post
    try {
      const results = await processPost(post);
      console.log('Scheduler test completed successfully');
      
      // Update status
      await Post.updateOne({ _id: post._id }, { status: 'completed' });
      
      res.json({ 
        message: 'Post processed successfully', 
        results 
      });
    } catch (error) {
      console.error('Error processing post:', error?.message);
      
      // Update status
      await Post.updateOne({ _id: post._id }, { status: 'failed' });
      
      res.status(500).json({ 
        error: 'Error processing post', 
        details: error?.message 
      });
    }
  } catch (err) {
    console.error('Error in test-scheduler endpoint:', err?.message);
    res.status(500).json({ error: 'Server Error', message: err?.message });
  }
});

module.exports = router; 