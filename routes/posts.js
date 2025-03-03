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
      twitter_access_token,
      twitter_access_token_secret
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
    
    // Add token fields if they exist
    if (tiktok_access_token) postData.tiktok_access_token = tiktok_access_token;
    if (tiktok_refresh_token) postData.tiktok_refresh_token = tiktok_refresh_token;
    if (twitter_access_token) postData.twitter_access_token = twitter_access_token;
    if (twitter_access_token_secret) postData.twitter_access_token_secret = twitter_access_token_secret;
    
    // Set status based on whether it's scheduled
    postData.status = isScheduled ? 'pending' : 'completed';
    
    // Create and save the post
    console.log('Saving post to database...');
    const newPost = new Post(postData);
    const post = await newPost.save();
    
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

module.exports = router; 