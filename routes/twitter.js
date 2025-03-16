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
    
    console.log('Twitter callback received:', { 
      hasCode: !!code,
      hasState: !!state,
      error: error || 'none',
      error_description: error_description || 'none' 
    });
    
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
      console.error('Invalid or expired state parameter:', state);
      console.error('Available states:', Array.from(codeVerifiers.keys()));
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Invalid or expired authorization session. Please try again.')}`);
    }
    
    // Get the code verifier for this state
    const codeVerifier = codeVerifiers.get(state);
    
    // Clean up the code verifier
    codeVerifiers.delete(state);
    
    console.log('Processing callback with code:', code);
    const tokenData = await twitterService.getAccessToken(code, codeVerifier);
    
    if (!tokenData?.access_token) {
      console.error('Token exchange failed:', tokenData?.error || 'Unknown error');
      return res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Failed to obtain access token. Please try again.')}`);
    }
    
    console.log('Token exchange successful, received tokens:', {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      accessTokenPrefix: tokenData.access_token ? tokenData.access_token.substring(0, 5) + '...' : 'missing',
      refreshTokenPrefix: tokenData.refresh_token ? tokenData.refresh_token.substring(0, 5) + '...' : 'missing',
      userId: tokenData.user_id,
      username: tokenData.username
    });
    
    // Attempt to get user profile data
    let profileData = {};
    try {
      const userInfo = await twitterService.getUserInfo(tokenData.access_token);
      if (userInfo) {
        profileData = {
          name: userInfo.name,
          profile_image_url: userInfo.profile_image_url
        };
      }
    } catch (error) {
      console.warn('Could not fetch Twitter user profile data:', error.message);
    }
    
    // Redirect to frontend with access token as a query parameter
    // In production, you should use a more secure method to transfer the token
    const redirectUrl = `${process.env.FRONTEND_URL}/twitter?access_token=${encodeURIComponent(tokenData.access_token)}&refresh_token=${encodeURIComponent(tokenData.refresh_token || '')}&user_id=${encodeURIComponent(tokenData.user_id || '')}&username=${encodeURIComponent(tokenData.username || '')}&name=${encodeURIComponent(profileData.name || '')}&profile_image_url=${encodeURIComponent(profileData.profile_image_url || '')}`;
    
    console.log('Redirecting to frontend with token data');
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Auth callback error:', error?.message);
    res.redirect(`${process.env.FRONTEND_URL}/twitter?error=${encodeURIComponent('Authentication failed: ' + (error?.message || 'Unknown error'))}`);
  }
});

// POST /twitter/post-video
router.post('/post-video', async (req, res) => {
  try {
    console.log('=== TWITTER POST VIDEO ROUTE START ===');
    console.log('Request body:', JSON.stringify(req.body || {}, null, 2));
    
    const { videoUrl, accessToken, accessTokenSecret, text, userId } = req?.body || {};
    
    if (!videoUrl || !accessToken || !accessTokenSecret) {
      console.log('Missing required parameters:', {
        hasVideoUrl: !!videoUrl,
        hasAccessToken: !!accessToken,
        hasAccessTokenSecret: !!accessTokenSecret
      });
      return res.status(400).json({ error: 'Video URL, access token, and access token secret are required' });
    }

    console.log('Posting video to Twitter with URL:', videoUrl);
    console.log('Twitter credentials check:', {
      hasAccessToken: !!accessToken,
      hasAccessTokenSecret: !!accessTokenSecret,
      accessTokenPrefix: accessToken ? accessToken.substring(0, 5) + '...' : 'missing',
      accessTokenSecretPrefix: accessTokenSecret ? accessTokenSecret.substring(0, 5) + '...' : 'missing',
      userId: userId || 'not provided'
    });

    const result = await twitterService.postMediaTweet(videoUrl, accessToken, text, accessTokenSecret);
    
    console.log('Twitter post result:', JSON.stringify(result || {}, null, 2));
    console.log('=== TWITTER POST VIDEO ROUTE END ===');
    
    res.status(200).json({ message: 'Video posted successfully', data: result });
  } catch (error) {
    console.error('=== TWITTER POST VIDEO ROUTE ERROR ===');
    console.error('Error posting video:', error?.message);
    console.error('Error stack:', error?.stack);
    
    // Check if this is an authentication error
    if (error?.message?.includes('authentication') || error?.message?.includes('Authentication')) {
      return res.status(401).json({ 
        error: 'Twitter authentication failed. Please reconnect your Twitter account and try again.',
        code: 'TWITTER_AUTH_ERROR'
      });
    }
    
    res.status(500).json({ error: 'Failed to post video to Twitter: ' + (error?.message || 'Unknown error') });
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

// GET /twitter/refresh-credentials
router.get('/refresh-credentials', async (req, res) => {
  try {
    // Check if we have the required tokens in the query parameters
    const refreshToken = req.query?.refreshToken;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }
    
    console.log('Refreshing Twitter credentials for user-initiated request');
    
    // Attempt to refresh the tokens
    const tokenData = await twitterService.refreshAccessToken(refreshToken);
    
    if (!tokenData?.access_token) {
      console.error('Failed to refresh Twitter credentials');
      return res.status(500).json({ 
        success: false,
        error: 'Failed to refresh Twitter credentials'
      });
    }
    
    console.log('Twitter credentials refreshed successfully');
    
    // Return the refreshed tokens
    return res.json({
      success: true,
      data: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token
      }
    });
  } catch (error) {
    console.error('Error refreshing Twitter credentials:', error?.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to refresh Twitter credentials: ' + (error?.message || 'Unknown error')
    });
  }
});

module.exports = router; 