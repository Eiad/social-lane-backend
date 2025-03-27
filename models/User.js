const mongoose = require('mongoose');

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
  // For storing provider-specific data
  providerData: {
    type: Object,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Create only necessary indexes (removed duplicates)
UserSchema.index({ role: 1 });

module.exports = mongoose.model('User', UserSchema, 'customers'); 