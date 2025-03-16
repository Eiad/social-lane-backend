const mongoose = require('mongoose');

// Define User Schema
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
    enum: ['Free', 'Pro'],
    default: 'Free'
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
    type: Map,
    of: mongoose.Schema.Types.Mixed,
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

// Indexes for faster queries
UserSchema.index({ uid: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ 'subscription.paypalSubscriptionId': 1 });

module.exports = mongoose.model('User', UserSchema); 