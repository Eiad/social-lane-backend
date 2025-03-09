const mongoose = require('mongoose');

// Define the TikTok account schema
const TikTokAccountSchema = new mongoose.Schema({
  accessToken: {
    type: String,
    required: true
  },
  refreshToken: {
    type: String
  },
  openId: {
    type: String,
    required: true
  }
}, { _id: false }); // _id: false prevents MongoDB from adding an _id field to subdocuments

const PostSchema = new mongoose.Schema({
  video_url: {
    type: String,
    required: true
  },
  video_id: {
    type: String
  },
  post_description: {
    type: String,
    required: true
  },
  platforms: {
    type: [String],
    required: true,
    enum: ['twitter', 'tiktok', 'instagram', 'facebook', 'linkedin']
  },
  userId: {
    type: String,
    required: true
  },
  isScheduled: {
    type: Boolean,
    default: false
  },
  scheduledDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  date: {
    type: Date,
    default: Date.now
  },
  // Legacy single account fields (maintained for backward compatibility)
  tiktok_access_token: {
    type: String
  },
  tiktok_refresh_token: {
    type: String
  },
  // New field for multiple TikTok accounts
  tiktok_accounts: {
    type: [TikTokAccountSchema],
    default: undefined
  },
  twitter_access_token: {
    type: String
  },
  twitter_access_token_secret: {
    type: String
  },
  twitter_refresh_token: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Post', PostSchema); 