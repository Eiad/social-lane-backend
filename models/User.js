// File: models/User.js
const mongoose = require('mongoose');

// Define the TikTok account schema within the User schema
const TikTokAccountSchema = new mongoose.Schema({
  accessToken: {
    type: String,
    required: true
  },
  refreshToken: {
    type: String // Ensure this exists to store refresh tokens
  },
  openId: {
    type: String,
    required: true,
    unique: true // Ensure openId is unique within the array for a user
  },
  username: {
    type: String
  },
  displayName: {
    type: String
  },
  avatarUrl: {
    type: String
  },
  avatarUrl100: {
    type: String
  },
  index: {
    type: Number
  },
  // Add a field to track token updates
  tokensUpdatedAt: {
    type: Date
  }
}, { _id: false }); // _id: false prevents MongoDB from adding an _id field to subdocuments

/**
 * User Schema
 *
 * Note: Role system was migrated from Free/Pro to Starter/Launch/Rise/Scale
 * - Starter (was Free): Free tier
 * - Launch (was Pro): $9/month tier
 * - Rise: $18/month tier
 * - Scale: $27/month tier
 */
const UserSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  displayName: {
    type: String,
    trim: true
  },
  photoURL: {
    type: String
  },
  role: {
    type: String,
    enum: ['Starter', 'Launch', 'Rise', 'Scale'],
    default: 'Starter'
  },
  // Useful for tracking when subscription started
  subscriptionStartDate: {
    type: Date
  },
  // Useful for tracking when subscription ends
  subscriptionEndDate: {
    type: Date
  },
  // PayPal subscription details
  subscription: {
    paypalSubscriptionId: String,
    status: {
      type: String,
      enum: ['APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED', 'INACTIVE'],
    },
    planId: String,
    createdAt: Date,
    updatedAt: Date,
    nextBillingTime: Date,
    failedPayments: {
      type: Number,
      default: 0
    }
  },
  // Store payment information for reference
  paymentHistory: [{
    amount: Number,
    currency: String,
    date: {
      type: Date,
      default: Date.now
    },
    paymentMethod: String,
    transactionId: String
  }],
  // Additional user preferences and settings
  preferences: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // For storing provider-specific data including TikTok accounts
  providerData: {
    tiktok: [TikTokAccountSchema], // Embed TikTokAccountSchema here
    twitter: mongoose.Schema.Types.Mixed, // Keep other providers flexible
    // Add other providers as needed
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  },
  // Track posts within the current cycle (especially for Starter)
  postsThisCycle: {
    type: Number,
    default: 0
  },
  // Track the start date of the current posting cycle (especially for Starter)
  cycleStartDate: {
    type: Date
  }
}, {
  timestamps: true
});

// Create only necessary indexes (removed duplicates)
UserSchema.index({ role: 1 });
// Add index for finding users by TikTok openId efficiently
UserSchema.index({ 'providerData.tiktok.openId': 1 });

module.exports = mongoose.model('User', UserSchema, 'customers');