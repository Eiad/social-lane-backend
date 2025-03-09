const express = require('express');
const router = express.Router();
const Post = require('../models/Post');

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
    console.log('Received POST request to /posts');
    
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
      twitter_refresh_token
    } = req.body;
    
    // Validate required fields
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      console.error('Missing or invalid platforms field');
      return res.status(400).json({ error: 'Platforms field is required and must be a non-empty array' });
    }
    
    if (!userId) {
      console.error('Missing userId field');
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    if (!post_description) {
      console.error('Missing post_description field');
      return res.status(400).json({ error: 'Post description is required' });
    }
    
    if (!video_url && !video_id) {
      console.error('Missing video_url or video_id field');
      return res.status(400).json({ error: 'Either video URL or video ID is required' });
    }
    
    console.log('Creating post with platforms:', platforms);
    console.log('Post is scheduled:', isScheduled);
    if (tiktok_accounts) {
      console.log('TikTok accounts provided:', tiktok_accounts.length);
      console.log('TikTok accounts data sample:', tiktok_accounts.map(acc => ({
        openId: acc.openId,
        hasAccessToken: !!acc.accessToken,
        hasRefreshToken: !!acc.refreshToken
      })));
    }
    
    // Create new post object with only provided fields
    const postData = {
      post_description,
      platforms,
      userId,
      date: new Date()
    };

    // Add optional fields if they exist
    if (video_url) postData.video_url = video_url;
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
    
    // Set status based on whether it's scheduled
    postData.status = isScheduled ? 'pending' : 'completed';
    
    // Create and save the post
    console.log('Saving post to database...');
    const newPost = new Post(postData);
    const post = await newPost.save();
    
    // Debug: Check if the saved post has the TikTok accounts
    const savedPost = await Post.findById(post._id).lean();
    console.log('Saved post:', {
      id: savedPost._id,
      has_tiktok_accounts: !!savedPost.tiktok_accounts,
      tiktok_accounts_count: savedPost.tiktok_accounts?.length || 0,
      has_legacy_tiktok: !!savedPost.tiktok_access_token,
      has_twitter: !!savedPost.twitter_access_token,
      has_twitter_refresh: !!savedPost.twitter_refresh_token
    });
    
    console.log('Post saved successfully with ID:', post._id);
    res.json(post);
  } catch (err) {
    console.error('Error creating post:', err?.message);
    if (err?.name === 'ValidationError') {
      // Handle Mongoose validation errors
      const validationErrors = Object.values(err.errors).map(error => error.message);
      return res.status(400).json({ error: 'Validation error', details: validationErrors });
    }
    res.status(500).json({ error: 'Server Error', message: err?.message });
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