const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const { processPost, checkUserLimits } = require('../services/scheduler');
const { hasReachedLimit } = require('../utils/roleLimits');
const User = require('../models/User');

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
    if (!video_url || !post_description || !platforms || !userId) {
      return res.status(400).json({
        success: false,
        error: 'Please provide required fields: video_url, post_description, platforms, userId'
      });
    }

    // Check if it's a scheduled post
    if (isScheduled) {
      // Check user limits for scheduled posts
      const user = await User.findOne({ uid: userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Count existing scheduled posts for this user
      const scheduledPostsCount = await Post.countDocuments({
        userId,
        isScheduled: true,
        status: 'pending'
      });

      // Check if user has reached their limit
      if (hasReachedLimit(user.role || 'Starter', 'scheduledPosts', scheduledPostsCount)) {
        return res.status(403).json({
          success: false,
          error: 'Scheduled posts limit reached',
          limit: user.role === 'Starter' ? 30 : 'unlimited',
          current: scheduledPostsCount
        });
      }
    }

    // Check social accounts limit
    if (platforms.includes('tiktok') || platforms.includes('twitter')) {
      const user = await User.findOne({ uid: userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Count social accounts
      let socialAccountsCount = 0;
      
      // Count TikTok accounts
      if (tiktok_accounts && Array.isArray(tiktok_accounts)) {
        socialAccountsCount += tiktok_accounts.length;
      } else if (tiktok_access_token) {
        socialAccountsCount += 1;
      }
      
      // Count Twitter accounts
      if (twitter_accounts && Array.isArray(twitter_accounts)) {
        socialAccountsCount += twitter_accounts.length;
      } else if (twitter_access_token) {
        socialAccountsCount += 1;
      }
      
      // Check if user has reached their limit
      if (hasReachedLimit(user.role || 'Starter', 'socialAccounts', socialAccountsCount)) {
        return res.status(403).json({
          success: false,
          error: 'Social accounts limit reached',
          limit: user.role === 'Starter' ? 5 : (user.role === 'Launch' ? 15 : (user.role === 'Rise' ? 30 : 'unlimited')),
          current: socialAccountsCount
        });
      }
    }

    // Prepare post data
    const postData = {
      video_url,
      post_description,
      platforms,
      userId
    };

    // Add optional fields if they exist
    if (video_id) postData.video_id = video_id;
    if (isScheduled !== undefined) postData.isScheduled = isScheduled;
    if (scheduledDate) postData.scheduledDate = scheduledDate;
    
    // Handle TikTok accounts
    if (tiktok_accounts && Array.isArray(tiktok_accounts) && tiktok_accounts.length > 0) {
      // Make sure the TikTok accounts have the right schema format
      postData.tiktok_accounts = tiktok_accounts.map(account => ({
        accessToken: account.accessToken,
        refreshToken: account.refreshToken || null,
        openId: account.openId
      }));
      console.log('Formatted TikTok accounts for database:', 
        postData.tiktok_accounts.map(acc => ({
          openId: acc.openId,
          hasAccessToken: !!acc.accessToken,
          hasRefreshToken: !!acc.refreshToken
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
      postData.twitter_accounts = twitter_accounts;
    }
    
    // Set status based on whether it's scheduled
    postData.status = isScheduled ? 'pending' : 'completed';
    
    // Create and save the post
    console.log('Saving post to database...');
    const newPost = new Post(postData);
    const post = await newPost.save();
    
    // Debug: Check if the saved post has the TikTok accounts
    const savedPost = await Post.findById(post._id).lean();
    if (tiktok_accounts && Array.isArray(tiktok_accounts) && tiktok_accounts.length > 0) {
      console.log('Saved post TikTok accounts count:', savedPost.tiktok_accounts?.length || 0);
    }
    
    // If not scheduled, process post immediately
    if (!isScheduled) {
      console.log('Processing post immediately (not scheduled)...');
      // Process the post (this could take some time, so we don't await it)
      processPost(post)
        .then(results => {
          console.log('Post processing completed:', results);
        })
        .catch(error => {
          console.error('Error processing post:', error);
        });
      
      // Return success response without waiting for processing to complete
      res.status(201).json({
        success: true,
        data: {
          _id: post._id,
          status: 'processing'
        },
        message: 'Post created and processing started'
      });
    } else {
      // For scheduled posts, just return the created post
      console.log('Post scheduled for later processing at:', scheduledDate);
      res.status(201).json({
        success: true,
        data: post,
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