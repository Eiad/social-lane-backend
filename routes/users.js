const express = require('express');
const router = express.Router();
const User = require('../models/User');
const userService = require('../services/userService');

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

    // Return the complete user object
    res.status(200).json({
      success: true,
      data: user
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
    const { uid, email, displayName, photoURL } = req.body;

    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        error: 'Please provide uid and email'
      });
    }

    // Use findOneAndUpdate with upsert option to create if not exists
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
        new: true, // Return the updated document
        upsert: true, // Create if it doesn't exist
        runValidators: true // Run validators on update
      }
    );

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error creating/updating user:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: 'User already exists with this email or uid'
      });
    }
    
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

    if (!role || !['Free', 'Pro'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid role (Free or Pro)'
      });
    }

    const user = await User.findOneAndUpdate(
      { uid: req.params.uid },
      {
        role,
        ...(role === 'Pro' && !req.body.keepSubscriptionDates ? {
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
    const tokenData = req.body;
    
    if (!tokenData || !Array.isArray(tokenData)) {
      return res.status(400).json({
        success: false,
        error: 'Twitter token data should be an array'
      });
    }
    
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
    const tokenData = req.body;
    
    if (!tokenData || !Array.isArray(tokenData)) {
      return res.status(400).json({
        success: false,
        error: 'TikTok token data should be an array'
      });
    }
    
    const user = await userService.updateSocialMediaTokens(uid, 'tiktok', tokenData);
    
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Error updating TikTok tokens:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
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

module.exports = router; 