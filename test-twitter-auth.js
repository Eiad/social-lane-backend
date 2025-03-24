/**
 * Direct Twitter OAuth 1.0a Authentication Test Script
 * 
 * This script tests the OAuth 1.0a flow with Twitter's API v1.1
 * It will:
 * 1. Generate an authentication URL
 * 2. Print it to the console
 * 3. Wait for you to authorize the app and paste the oauth_verifier
 * 4. Attempt to exchange for access tokens
 * 
 * Run with: node test-twitter-auth.js
 */

require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const readline = require('readline');

// Create CLI interface for input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Twitter API credentials from environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;

// Store token data
let oauthToken = '';
let oauthTokenSecret = '';

// Run the test
async function testTwitterAuth() {
  try {
    console.log('=== TWITTER OAUTH 1.0a TEST ===');
    console.log('API Key (masked):', TWITTER_API_KEY ? `${TWITTER_API_KEY.substring(0, 4)}...${TWITTER_API_KEY.substring(TWITTER_API_KEY.length - 4)}` : 'MISSING');
    console.log('API Secret (masked):', TWITTER_API_SECRET ? `${TWITTER_API_SECRET.substring(0, 4)}...${TWITTER_API_SECRET.substring(TWITTER_API_SECRET.length - 4)}` : 'MISSING');
    
    if (!TWITTER_API_KEY || !TWITTER_API_SECRET) {
      throw new Error('API Key or Secret is missing. Check your .env file.');
    }
    
    // Step 1: Generate auth URL
    console.log('\n=== Step 1: Generate Authentication URL ===');
    const callbackUrl = 'https://sociallane-backend.mindio.chat/twitter/callback';
    console.log('Using callback URL:', callbackUrl);
    
    const client = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_SECRET,
    });
    
    // Enable debug mode to see requests
    client.debug = true;
    
    console.log('Generating auth link...');
    const authLink = await client.generateAuthLink(callbackUrl, { 
      linkMode: 'authorize',
      forceLogin: true 
    });
    
    console.log('\nAuth link generated successfully:');
    console.log('- OAuth Token:', authLink.oauth_token);
    console.log('- URL:', authLink.url);
    
    // Store token data
    oauthToken = authLink.oauth_token;
    oauthTokenSecret = authLink.oauth_token_secret;
    
    console.log('\n=== Step 2: Authorize the Application ===');
    console.log('1. Copy this URL and open it in your browser:', authLink.url);
    console.log('2. Authorize the application');
    console.log('3. You will be redirected to a callback URL with oauth_verifier parameter');
    console.log('4. Copy the oauth_verifier value from the URL');
    
    // Wait for user to paste the oauth_verifier
    await new Promise(resolve => {
      rl.question('\nPaste the oauth_verifier value or full callback URL here: ', async (input) => {
        if (!input) {
          console.error('No input provided.');
          rl.close();
          return;
        }
        
        // Extract oauth_verifier if user pasted the full URL
        let oauthVerifier = input.trim();
        
        if (oauthVerifier.includes('oauth_verifier=')) {
          try {
            // Extract from URL if the full callback URL was pasted
            console.log('Detected full callback URL, extracting oauth_verifier...');
            const url = new URL(oauthVerifier);
            oauthVerifier = url.searchParams.get('oauth_verifier');
            console.log('Extracted oauth_verifier:', oauthVerifier);
          } catch (parseError) {
            // Try to extract manually if URL parsing fails
            const match = oauthVerifier.match(/oauth_verifier=([^&]+)/);
            if (match && match[1]) {
              oauthVerifier = match[1];
              console.log('Manually extracted oauth_verifier:', oauthVerifier);
            }
          }
        }
        
        if (!oauthVerifier) {
          console.error('Could not extract a valid oauth_verifier.');
          rl.close();
          return;
        }
        
        console.log('\n=== Step 3: Exchange Verifier for Access Tokens ===');
        console.log('OAuth Parameters:');
        console.log('- oauth_token:', oauthToken);
        console.log('- oauth_verifier:', oauthVerifier);
        
        try {
          // Create client with request token
          const authClient = new TwitterApi({
            appKey: TWITTER_API_KEY,
            appSecret: TWITTER_API_SECRET,
            accessToken: oauthToken,
            accessSecret: oauthTokenSecret,
          });
          
          console.log('\nAttempting to exchange verifier for access tokens...');
          
          // Exchange for access tokens
          const { client: loggedClient, accessToken, accessSecret } = await authClient.login(oauthVerifier);
          
          console.log('\n✅ Access tokens obtained successfully:');
          console.log('- Access Token:', accessToken);
          console.log('- Access Token Secret:', accessSecret);
          
          // Test the credentials by getting user data
          console.log('\nTesting credentials by getting user info...');
          const userInfo = await loggedClient.v2.me();
          
          console.log('\n✅ User info retrieved successfully:');
          console.log('- User ID:', userInfo.data.id);
          console.log('- Username:', userInfo.data.username);
          console.log('- Name:', userInfo.data.name);
          
          console.log('\n=== TEST COMPLETE: SUCCESS ===');
          console.log('Authentication flow works correctly!');
        } catch (error) {
          console.error('\n❌ Error exchanging verifier:');
          console.error('- Message:', error.message);
          
          if (error.data) {
            console.error('- API Error Data:', JSON.stringify(error.data, null, 2));
          }
          
          // Try alternative method
          console.log('\nTrying alternative method for token exchange...');
          try {
            // Create a fresh client
            const altClient = new TwitterApi({
              appKey: TWITTER_API_KEY,
              appSecret: TWITTER_API_SECRET,
            });
            
            // Make manual request to token endpoint
            const tokenEndpoint = 'https://api.twitter.com/oauth/access_token';
            const params = new URLSearchParams();
            params.append('oauth_token', oauthToken);
            params.append('oauth_verifier', oauthVerifier);
            
            const response = await altClient.v1.get(tokenEndpoint, { params });
            console.log('Raw response:', response);
            
            const responseParams = new URLSearchParams(response);
            const altAccessToken = responseParams.get('oauth_token');
            const altAccessSecret = responseParams.get('oauth_token_secret');
            const userId = responseParams.get('user_id');
            const screenName = responseParams.get('screen_name');
            
            if (altAccessToken && altAccessSecret) {
              console.log('\n✅ Alternative method successful:');
              console.log('- Access Token:', altAccessToken);
              console.log('- Access Token Secret:', altAccessSecret);
              console.log('- User ID:', userId);
              console.log('- Screen Name:', screenName);
              
              console.log('\n=== TEST COMPLETE: SUCCESS (Alternative Method) ===');
            } else {
              throw new Error('Failed to parse response');
            }
          } catch (altError) {
            console.error('\n❌ Alternative method failed:');
            console.error('- Message:', altError.message);
            console.error('\n=== TEST COMPLETE: FAILURE ===');
          }
        }
        
        rl.close();
        resolve();
      });
    });
  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error('- Message:', error.message);
    console.error('- Stack:', error.stack);
    console.error('\n=== TEST COMPLETE: FAILURE ===');
    rl.close();
  }
}

// Run the test
testTwitterAuth(); 