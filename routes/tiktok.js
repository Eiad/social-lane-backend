const express = require('express');
const router = express.Router();
const tiktokService = require('../services/tiktokService');

// Get TikTok auth URL
router.get('/auth', (req, res) => {
  try {
    const authUrl = tiktokService.getAuthUrl();
    res.json({ authUrl });
  } catch (error) {
    console.error('Auth URL error:', error?.message);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// TikTok OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req?.query || {};
    
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
    
    // Redirect to frontend with access token as a query parameter
    // In production, you should use a more secure method to transfer the token
    const redirectUrl = `${process.env.FRONTEND_URL}/tiktok?access_token=${encodeURIComponent(tokenData.access_token)}&open_id=${encodeURIComponent(tokenData.open_id)}${tokenData.refresh_token ? `&refresh_token=${encodeURIComponent(tokenData.refresh_token)}` : ''}`;
    res.redirect(redirectUrl);
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

    const userInfo = await tiktokService.getUserInfo(accessToken, refreshToken);
    res.json({ data: userInfo });
  } catch (error) {
    console.error('Error getting user info:', error?.message);
    res.status(500).json({ error: 'Failed to get user info: ' + (error?.message || 'Unknown error') });
  }
});

module.exports = router;