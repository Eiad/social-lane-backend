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
  }
}, { _id: false }); // _id: false prevents MongoDB from adding an _id field to subdocuments

// Define the Twitter account schema
const TwitterAccountSchema = new mongoose.Schema({
  accessToken: {
    type: String,
    // Not required, can be fetched from DB based on userId
    required: false
  },
  accessTokenSecret: {
    type: String,
    // Not required, can be fetched from DB based on userId
    required: false
  },
  userId: {
    type: String,
    required: true
  },
  username: {
    type: String
  },
  name: {
    type: String
  },
  profileImageUrl: {
    type: String
  }
}, { _id: false });

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
    default: ''
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
  // Legacy Twitter fields (maintained for backward compatibility)
  twitter_access_token: {
    type: String
  },
  twitter_access_token_secret: {
    type: String
  },
  // New field for multiple Twitter accounts
  twitter_accounts: {
    type: [TwitterAccountSchema],
    default: undefined
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Post', PostSchema, 'posts'); 