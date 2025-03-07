const express = require('express');
const router = express.Router();
const twitterService = require('../services/twitterService');

// Store code verifiers temporarily (in a real app, use a database or session)
const codeVerifiers = new Map();

// Get Twitter auth URL
router.get('/auth', (req, res) => {
  try {
    const authData = twitterService.getAuthUrl();
    
    if (!authData?.url || !authData?.codeVerifier || !authData?.state) {
      console.error('Invalid auth data returned:', authData);
      return res.status(500).json({ error: 'Failed to generate auth URL: Invalid auth data' });
    }
    
    const { url, codeVerifier, state } = authData;
    
    console.log('Generated Twitter Auth URL:', url);
    
    // Store the code verifier for this state
    codeVerifiers.set(state, codeVerifier);
    
    // Set a timeout to clean up the code verifier after 10 minutes
    setTimeout(() => {
      codeVerifiers.delete(state);
    }, 10 * 60 * 1000);
    
    res.json({ authUrl: url, state });
  } catch (error) {
    console.error('Auth URL error:', error?.message);
    res.status(500).json({ error: 'Failed to generate auth URL: ' + (error?.message || 'Unknown error') });
  }
});

// Twitter OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req?.query || {};
    
    // Handle error from Twitter
    if (error) {
      console.error('Twitter auth error:', error, error_description);
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent(error_description || 'Authentication failed')}`);
    }
    
    if (!code) {
      console.error('No authorization code provided');
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('No authorization code provided')}`);
    }
    
    if (!state || !codeVerifiers.has(state)) {
      console.error('Invalid or expired state parameter');
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Invalid or expired state parameter')}`);
    }
    
    // Get the code verifier for this state
    const codeVerifier = codeVerifiers.get(state);
    
    // Clean up the code verifier
    codeVerifiers.delete(state);
    
    console.log('Processing callback with code:', code);
    const tokenData = await twitterService.getAccessToken(code, codeVerifier);
    
    if (!tokenData?.access_token) {
      console.error('Token exchange failed:', tokenData?.error || 'Unknown error');
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent(tokenData?.error || 'Token exchange failed')}`);
    }
    
    console.log('Token exchange successful, received tokens:', {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      accessTokenPrefix: tokenData.access_token ? tokenData.access_token.substring(0, 5) + '...' : 'missing',
      refreshTokenPrefix: tokenData.refresh_token ? tokenData.refresh_token.substring(0, 5) + '...' : 'missing',
      userId: tokenData.user_id,
      username: tokenData.username
    });
    
    // Redirect to frontend with access token as a query parameter
    // In production, you should use a more secure method to transfer the token
    const redirectUrl = `${process.env.FRONTEND_URL}/twitter?access_token=${encodeURIComponent(tokenData.access_token)}&refresh_token=${encodeURIComponent(tokenData.refresh_token || '')}&user_id=${encodeURIComponent(tokenData.user_id || '')}&username=${encodeURIComponent(tokenData.username || '')}`;
    
    console.log('Redirecting to frontend with token data');
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Auth callback error:', error?.message);
    res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Authentication failed: ' + (error?.message || 'Unknown error'))}`);
  }
});

// POST /twitter/post-media
router.post('/post-media', async (req, res) => {
  try {
    const { videoUrl, accessToken, accessTokenSecret, text } = req?.body || {};
    
    if (!videoUrl || !accessToken) {
      console.log('Missing required parameters:', {
        hasVideoUrl: !!videoUrl,
        hasAccessToken: !!accessToken,
        hasAccessTokenSecret: !!accessTokenSecret
      });
      return res.status(400).json({ error: 'Video URL and access token are required' });
    }
    
    console.log('=== TWITTER POST MEDIA ROUTE START ===');
    console.log('Posting media to Twitter with URL:', videoUrl);
    console.log('Twitter credentials check:', {
      hasAccessToken: !!accessToken,
      hasAccessTokenSecret: !!accessTokenSecret,
      accessTokenPrefix: accessToken ? accessToken.substring(0, 5) + '...' : 'missing',
      accessTokenSecretPrefix: accessTokenSecret ? accessTokenSecret.substring(0, 5) + '...' : 'missing'
    });
    
    // Check if we have the required credentials
    const consumerKey = process.env.TWITTER_API_KEY;
    const consumerSecret = process.env.TWITTER_API_SECRET;
    
    console.log('Twitter API credentials check:', {
      hasConsumerKey: !!consumerKey,
      hasConsumerSecret: !!consumerSecret,
      consumerKeyPrefix: consumerKey ? consumerKey.substring(0, 5) + '...' : 'missing'
    });
    
    if (!consumerKey || !consumerSecret) {
      console.error('Missing Twitter API credentials in environment variables');
      return res.status(500).json({ error: 'Server configuration error: Missing Twitter API credentials' });
    }
    
    try {
      const result = await twitterService.postMediaTweet(videoUrl, accessToken, text, accessTokenSecret);
      
      if (!result?.success) {
        console.error('Twitter post failed:', result?.error || 'Unknown error');
        return res.status(500).json({ error: 'Failed to post media to Twitter: ' + (result?.error || 'Unknown error') });
      }
      
      console.log('Twitter post result:', JSON.stringify(result || {}, null, 2));
      console.log('=== TWITTER POST MEDIA ROUTE END ===');
      
      res.status(200).json({ message: 'Media posted successfully to Twitter', data: result });
    } catch (postError) {
      console.error('=== TWITTER POST MEDIA TWEET ERROR ===');
      console.error('Error posting media tweet:', postError?.message);
      console.error('Error stack:', postError?.stack);
      
      // Check if this is an authentication error
      if (postError?.message?.includes('authentication') || postError?.message?.includes('Authentication')) {
        return res.status(401).json({ 
          error: 'Twitter authentication failed. Please reconnect your Twitter account and try again.',
          code: 'TWITTER_AUTH_ERROR'
        });
      }
      
      throw postError; // Re-throw to be caught by the outer catch block
    }
  } catch (error) {
    console.error('=== TWITTER POST MEDIA ROUTE ERROR ===');
    console.error('Error posting media:', error?.message);
    console.error('Error stack:', error?.stack);
    res.status(500).json({ error: 'Failed to post media to Twitter: ' + (error?.message || 'Unknown error') });
  }
});

// GET /twitter/user-info
router.get('/user-info', async (req, res) => {
  try {
    const accessToken = req.headers?.authorization?.split('Bearer ')?.[1];
    
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token provided' });
    }
    
    const userInfo = await twitterService.getUserInfo(accessToken);
    
    if (!userInfo) {
      return res.status(500).json({ error: 'Failed to get user info: No user data returned' });
    }
    
    res.json({ data: userInfo });
  } catch (error) {
    console.error('Error getting user info:', error?.message);
    res.status(500).json({ error: 'Failed to get user info: ' + (error?.message || 'Unknown error') });
  }
});

// POST /twitter/refresh-token
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req?.body || {};
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }
    
    const tokenData = await twitterService.refreshAccessToken(refreshToken);
    
    if (!tokenData?.access_token) {
      return res.status(500).json({ error: 'Failed to refresh token: No token data returned' });
    }
    
    res.json({ data: tokenData });
  } catch (error) {
    console.error('Error refreshing token:', error?.message);
    res.status(500).json({ error: 'Failed to refresh token: ' + (error?.message || 'Unknown error') });
  }
});

module.exports = router; 