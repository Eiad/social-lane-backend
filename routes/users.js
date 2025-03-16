const express = require('express');
const router = express.Router();
const User = require('../models/User');
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
    
    // Validate required fields
    if (!uid || !email) {
      return res.status(400).json({
        success: false,
        error: 'UID and email are required'
      });
    }
    
    // Try to find existing user first
    let user = await User.findOne({ uid });
    
    if (user) {
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
      // Create new user
      user = new User({
        uid,
        email,
        displayName: displayName || email.split('@')[0],
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

module.exports = router; 