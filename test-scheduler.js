/**
 * Test script for the scheduler service
 * This script helps debug issues with scheduled posts
 */
const axios = require('axios');
require('dotenv').config();

const { processPost } = require('./services/scheduler');

// Sample post data with legacy TikTok credentials
const samplePostLegacy = {
  video_url: 'https://media.mindio.chat/sample-video.mp4',
  post_description: 'Test post using legacy TikTok credentials',
  platforms: ['tiktok', 'twitter'],
  userId: 'test-user',
  tiktok_access_token: process.env.TEST_TIKTOK_ACCESS_TOKEN,
  tiktok_refresh_token: process.env.TEST_TIKTOK_REFRESH_TOKEN,
  twitter_access_token: process.env.TEST_TWITTER_ACCESS_TOKEN,
  twitter_access_token_secret: process.env.TEST_TWITTER_ACCESS_TOKEN_SECRET
};

// Sample post data with multiple TikTok accounts
const samplePostMultiAccount = {
  video_url: 'https://media.mindio.chat/sample-video.mp4',
  post_description: 'Test post using multiple TikTok accounts',
  platforms: ['tiktok', 'twitter'],
  userId: 'test-user',
  tiktok_accounts: [
    {
      accessToken: process.env.TEST_TIKTOK_ACCESS_TOKEN,
      refreshToken: process.env.TEST_TIKTOK_REFRESH_TOKEN,
      openId: process.env.TEST_TIKTOK_OPEN_ID || 'test-account-1'
    }
  ],
  twitter_access_token: process.env.TEST_TWITTER_ACCESS_TOKEN,
  twitter_access_token_secret: process.env.TEST_TWITTER_ACCESS_TOKEN_SECRET
};

// Test the scheduler with legacy format
async function testLegacyFormat() {
  console.log('Testing scheduler with legacy TikTok credentials...');
  try {
    const result = await processPost(samplePostLegacy);
    console.log('Result:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error processing post with legacy format:', error);
    throw error;
  }
}

// Test the scheduler with multiple accounts format
async function testMultiAccountFormat() {
  console.log('Testing scheduler with multiple TikTok accounts...');
  try {
    const result = await processPost(samplePostMultiAccount);
    console.log('Result:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('Error processing post with multi-account format:', error);
    throw error;
  }
}

// Run the tests
async function runTests() {
  try {
    const testType = process.argv[2] || 'both';
    let legacyResult, multiAccountResult;

    if (testType === 'legacy' || testType === 'both') {
      legacyResult = await testLegacyFormat();
    }

    if (testType === 'multi' || testType === 'both') {
      multiAccountResult = await testMultiAccountFormat();
    }

    console.log('\n=== Test Summary ===');
    if (legacyResult) {
      console.log('Legacy format test:', 
        legacyResult.tiktok && legacyResult.tiktok.some(acc => acc.success) ? 'Success' : 'Failed');
    }
    if (multiAccountResult) {
      console.log('Multi-account format test:', 
        multiAccountResult.tiktok && multiAccountResult.tiktok.some(acc => acc.success) ? 'Success' : 'Failed');
    }
  } catch (error) {
    console.error('Test runner error:', error);
  }
}

// Run the tests if this script is executed directly
if (require.main === module) {
  runTests()
    .then(() => console.log('Tests completed'))
    .catch(err => console.error('Tests failed:', err));
}

module.exports = { testLegacyFormat, testMultiAccountFormat }; 