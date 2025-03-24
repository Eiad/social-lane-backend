/**
 * Twitter API Credentials Test
 * 
 * This script tests your Twitter API credentials by:
 * 1. Attempting to generate an OAuth 1.0a authentication URL
 * 2. Checking if OAuth 2.0 App-Only authentication works
 * 
 * Run with: node test-twitter-credentials.js
 */

require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');

// Twitter API credentials from environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;

async function testTwitterCredentials() {
  console.log('=== TWITTER API CREDENTIALS TEST ===');
  console.log('Testing credentials with partial masking for security:');
  console.log('API Key:', TWITTER_API_KEY ? `${TWITTER_API_KEY.substring(0, 4)}...${TWITTER_API_KEY.substring(TWITTER_API_KEY.length - 4)}` : 'MISSING');
  console.log('API Secret:', TWITTER_API_SECRET ? `${TWITTER_API_SECRET.substring(0, 4)}...${TWITTER_API_SECRET.substring(TWITTER_API_SECRET.length - 4)}` : 'MISSING');
  console.log('App Access Token:', TWITTER_ACCESS_TOKEN ? `${TWITTER_ACCESS_TOKEN.substring(0, 4)}...${TWITTER_ACCESS_TOKEN.substring(TWITTER_ACCESS_TOKEN.length - 4)}` : 'MISSING');
  console.log('App Access Token Secret:', TWITTER_ACCESS_TOKEN_SECRET ? `${TWITTER_ACCESS_TOKEN_SECRET.substring(0, 4)}...${TWITTER_ACCESS_TOKEN_SECRET.substring(TWITTER_ACCESS_TOKEN_SECRET.length - 4)}` : 'MISSING');
  
  // Test 1: Create OAuth 1.0a client for app authentication
  console.log('\n=== Test 1: OAuth 1.0a App Authentication ===');
  try {
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET) {
      throw new Error('API Key or Secret is missing');
    }
    
    // Test if we can generate an auth URL
    const callbackUrl = 'https://sociallane-backend.mindio.chat/twitter/callback';
    console.log('Using callback URL:', callbackUrl);
    
    const client = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_SECRET,
    });
    
    console.log('Created OAuth 1.0a client successfully');
    
    const authLink = await client.generateAuthLink(callbackUrl, { 
      linkMode: 'authenticate',
      forceLogin: true 
    });
    
    console.log('Generated auth link successfully:');
    console.log('- OAuth Token:', authLink.oauth_token);
    console.log('- URL:', authLink.url);
    console.log('✅ OAuth 1.0a app authentication working correctly');
  } catch (error) {
    console.error('❌ OAuth 1.0a app authentication failed:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    if (error.data) {
      console.error('API Error Data:', JSON.stringify(error.data, null, 2));
    }
  }
  
  // Test 2: App-only auth (OAuth 2.0)
  console.log('\n=== Test 2: App-Only Authentication (OAuth 2.0) ===');
  try {
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET) {
      throw new Error('API Key or Secret is missing');
    }
    
    const appOnlyClient = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_SECRET,
    });
    
    console.log('Attempting to get app-only (OAuth 2.0) bearer token...');
    const bearerClient = await appOnlyClient.appLogin();
    
    console.log('✅ Successfully obtained bearer token');
    
    // Try to get some data to verify the token works
    try {
      console.log('Testing the bearer token with a simple API call...');
      const user = await bearerClient.v2.userByUsername('twitter');
      console.log('Got user data:', user.data);
      console.log('✅ Bearer token is working correctly');
    } catch (apiError) {
      console.error('❌ Bearer token API call failed:');
      console.error('Error:', apiError.message);
      if (apiError.data) {
        console.error('API Error Data:', JSON.stringify(apiError.data, null, 2));
      }
    }
  } catch (error) {
    console.error('❌ App-only authentication failed:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    if (error.data) {
      console.error('API Error Data:', JSON.stringify(error.data, null, 2));
    }
  }

  // Test 3: App auth with app tokens
  if (TWITTER_ACCESS_TOKEN && TWITTER_ACCESS_TOKEN_SECRET) {
    console.log('\n=== Test 3: App Authentication with App Tokens ===');
    try {
      const appClient = new TwitterApi({
        appKey: TWITTER_API_KEY,
        appSecret: TWITTER_API_SECRET,
        accessToken: TWITTER_ACCESS_TOKEN,
        accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
      });
      
      console.log('Testing app client with a verify credentials call...');
      const verifyResult = await appClient.v1.verifyCredentials();
      
      console.log('✅ App client verification successful:');
      console.log('Username:', verifyResult.screen_name);
      console.log('User ID:', verifyResult.id_str);
      console.log('App tokens are correctly configured');
    } catch (error) {
      console.error('❌ App client verification failed:');
      console.error('Error:', error.message);
      
      if (error.data) {
        console.error('API Error Data:', JSON.stringify(error.data, null, 2));
      }
    }
  } else {
    console.log('\n=== Test 3: Skipped - App tokens not provided ===');
  }
  
  console.log('\n=== TWITTER API CREDENTIALS TEST COMPLETE ===');
}

testTwitterCredentials().catch(error => {
  console.error('Test script error:', error);
}); 