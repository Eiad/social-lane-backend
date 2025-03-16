const express = require('express');
const router = express.Router();
const tiktokService = require('../services/tiktokService');

// Get TikTok auth URL
router.get('/auth', (req, res) => {
  try {
    // Add force_login=true to allow switching accounts
    const authUrl = tiktokService.getAuthUrl({
      forceLogin: true,
      state: Math.random().toString(36).substring(2)
    });
    
    // Instead of sending JSON, redirect directly to TikTok
    res.redirect(authUrl);
  } catch (error) {
    console.error('Auth URL error:', error?.message);
    res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent('Failed to generate auth URL')}`);
  }
});

// TikTok OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, error, error_description, state, scopes } = req?.query || {};
    
    // Log the scopes that were authorized by the user
    console.log('TikTok callback received with scopes:', scopes);
    
    // Handle error from TikTok
    if (error) {
      console.error('TikTok auth error:', error, error_description);
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent(error_description || 'Authentication failed')}`);
    }
    
    if (!code) {
      console.error('No authorization code provided');
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent('No authorization code provided')}`);
    }

    console.log('Processing callback with code:', code);
    const tokenData = await tiktokService.getAccessToken(code);
    
    if (!tokenData || tokenData.error) {
      console.error('Token exchange failed:', tokenData?.error || 'Unknown error');
      return res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent(tokenData?.error_description || 'Token exchange failed')}`);
    }
    
    // Check if user.info.basic scope was granted
    const grantedScopes = tokenData.scope?.split(',') || [];
    console.log('Granted scopes from token response:', grantedScopes);
    
    if (!grantedScopes.includes('user.info.basic')) {
      console.warn('user.info.basic scope was not granted. User profile info may not be available.');
    }
    
    // Fetch user information immediately after getting the token
    try {
      console.log('Attempting to fetch TikTok user info with received token');
      const userInfo = await tiktokService.getUserInfo(tokenData.access_token, tokenData.refresh_token);
      
      // Add user info to the redirect URL
      const userInfoParams = userInfo ? {
        username: userInfo.username || '',
        display_name: userInfo.display_name || '',
        avatar_url: userInfo.avatar_url || '',
        avatar_url_100: userInfo.avatar_url_100 || ''
      } : {};
      
      console.log('User info retrieved successfully:', {
        hasUsername: !!userInfo?.username,
        hasDisplayName: !!userInfo?.display_name,
        hasAvatarUrl: !!userInfo?.avatar_url,
        hasAvatarUrl100: !!userInfo?.avatar_url_100
      });
      
      // Redirect to frontend with access token and user info as query parameters
      const redirectParams = new URLSearchParams({
        access_token: tokenData.access_token,
        open_id: tokenData.open_id,
        ...(tokenData.refresh_token ? { refresh_token: tokenData.refresh_token } : {}),
        ...(userInfoParams ? {
          username: userInfoParams.username,
          display_name: userInfoParams.display_name,
          avatar_url: userInfoParams.avatar_url,
          avatar_url_100: userInfoParams.avatar_url_100
        } : {})
      });
      
      const redirectUrl = `${process.env.FRONTEND_URL}/tiktok?${redirectParams.toString()}`;
      res.redirect(redirectUrl);
    } catch (userInfoError) {
      console.error('Error fetching user info after token exchange:', userInfoError);
      console.error('Error details:', userInfoError?.response?.data || userInfoError?.message);
      
      // Continue with the redirect even if user info fetch fails
      const redirectUrl = `${process.env.FRONTEND_URL}/tiktok?access_token=${encodeURIComponent(tokenData.access_token)}&open_id=${encodeURIComponent(tokenData.open_id)}${tokenData.refresh_token ? `&refresh_token=${encodeURIComponent(tokenData.refresh_token)}` : ''}`;
      res.redirect(redirectUrl);
    }
  } catch (error) {
    console.error('Auth callback error:', error?.message);
    res.redirect(`${process.env.FRONTEND_URL}/tiktok?error=${encodeURIComponent('Authentication failed: ' + (error?.message || 'Unknown error'))}`);
  }
});

// POST /tiktok/post-video
router.post('/post-video', async (req, res) => {
  try {
    const { videoUrl, accessToken, refreshToken, caption } = req?.body || {};
    if (!videoUrl || !accessToken) {
      console.log('Missing required parameters:', {
        hasVideoUrl: !!videoUrl,
        hasAccessToken: !!accessToken
      });
      return res.status(400).json({ error: 'Video URL and access token are required' });
    }

    const result = await tiktokService.postVideo(videoUrl, accessToken, caption, refreshToken);
    
    console.log('TikTok post result:', JSON.stringify(result || {}, null, 2));
    console.log('=== TIKTOK POST VIDEO ROUTE END ===');
    
    res.status(200).json({ message: 'Video posted successfully', data: result });
  } catch (error) {
    console.error('=== TIKTOK POST VIDEO ROUTE ERROR ===');
    console.error('Error posting video:', error?.message);
    console.error('Error stack:', error?.stack);
    res.status(500).json({ error: 'Failed to post video to TikTok: ' + (error?.message || 'Unknown error') });
  }
});

// GET /tiktok/user-info
router.get('/user-info', async (req, res) => {
  try {
    const accessToken = req.headers.authorization?.split('Bearer ')?.[1];
    const refreshToken = req.headers['x-refresh-token'];
    
    if (!accessToken) {
      return res.status(401).json({ error: 'No access token provided' });
    }

    // Add CORS headers
    res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL);
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Authorization, X-Refresh-Token, Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const userInfo = await tiktokService.getUserInfo(accessToken, refreshToken);
    res.json({ data: userInfo });
  } catch (error) {
    console.error('Error getting user info:', error?.message);
    res.status(500).json({ error: 'Failed to get user info: ' + (error?.message || 'Unknown error') });
  }
});

module.exports = router;