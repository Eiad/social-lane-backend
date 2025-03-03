const cron = require('node-cron');
const Post = require('../models/Post');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// Initialize the scheduler
const initScheduler = () => {
  console.log('Initializing post scheduler...');
  
  // Run every minute to check for posts that need to be published
  cron.schedule('* * * * *', async () => {
    try {
      // Find posts that are scheduled and due for publishing
      const now = new Date();
      const posts = await Post.find({
        isScheduled: true,
        scheduledDate: { $lte: now },
        status: 'pending'
      });
      
      if (posts.length > 0) {
        console.log(`Found ${posts.length} scheduled posts to publish`);
        
        // Process each post
        for (const post of posts) {
          try {
            // Update status to processing
            post.status = 'processing';
            await post.save();
            
            // Process the post
            await processPost(post);
            
            // Update status to completed
            post.status = 'completed';
            await post.save();
            
            console.log(`Successfully published scheduled post: ${post._id}`);
          } catch (error) {
            console.error(`Error publishing scheduled post ${post._id}:`, error?.message);
            
            // Update status to failed
            post.status = 'failed';
            await post.save();
          }
        }
      }
    } catch (error) {
      console.error('Error in scheduler:', error?.message);
    }
  });
  
  console.log('Post scheduler initialized');
};

// Process a post by publishing to selected platforms
const processPost = async (post) => {
  const { 
    video_url, 
    post_description, 
    platforms, 
    userId,
    tiktok_access_token,
    tiktok_refresh_token,
    twitter_access_token,
    twitter_access_token_secret
  } = post;
  
  if (!video_url || !platforms || platforms.length === 0) {
    throw new Error('Invalid post data');
  }
  
  const results = {};
  
  // Process each platform sequentially
  for (const platform of platforms) {
    try {
      console.log(`Processing platform: ${platform}`);
      
      if (platform === 'tiktok' && tiktok_access_token) {
        // Post to TikTok
        const tiktokResult = await postToTikTok(video_url, post_description, tiktok_access_token, tiktok_refresh_token);
        results.tiktok = { success: true, ...tiktokResult };
        console.log('TikTok posting completed successfully');
      } 
      else if (platform === 'twitter' && twitter_access_token && twitter_access_token_secret) {
        // Post to Twitter
        try {
          console.log('Posting to Twitter with credentials:', { 
            hasAccessToken: !!twitter_access_token, 
            hasAccessTokenSecret: !!twitter_access_token_secret,
            accessTokenPrefix: twitter_access_token ? twitter_access_token.substring(0, 5) + '...' : 'missing',
            accessTokenSecretPrefix: twitter_access_token_secret ? twitter_access_token_secret.substring(0, 5) + '...' : 'missing'
          });
          
          const twitterResult = await postToTwitter(video_url, post_description, twitter_access_token, twitter_access_token_secret);
          results.twitter = { success: true, ...twitterResult };
          console.log('Twitter posting completed successfully');
        } catch (twitterError) {
          console.error('Error posting to Twitter:', twitterError?.message);
          
          // Check if this is an authentication error
          if (twitterError?.message?.includes('authentication') || 
              twitterError?.message?.includes('Authentication') ||
              twitterError?.message?.includes('Bad Authentication data')) {
            results.twitter = { 
              success: false, 
              error: 'Twitter authentication failed. Please reconnect your Twitter account.',
              code: 'TWITTER_AUTH_ERROR'
            };
          } else {
            results.twitter = { success: false, error: twitterError?.message };
          }
        }
      }
      else {
        console.log(`Skipping ${platform} due to missing credentials`);
        results[platform] = { success: false, error: 'Missing credentials' };
      }
    } catch (error) {
      console.error(`Error posting to ${platform}:`, error?.message);
      results[platform] = { success: false, error: error?.message };
      // Continue with other platforms even if one fails
    }
  }
  
  // Check if any platform was successful
  const anySuccess = Object.values(results).some(result => result?.success);
  if (!anySuccess) {
    throw new Error('Failed to post to any platform');
  }
  
  return results;
};

// Post to TikTok
const postToTikTok = async (videoUrl, caption, accessToken, refreshToken) => {
  try {
    // Check if we need to refresh the token
    let tokenToUse = accessToken;
    
    // If we have a refresh token, we could implement token refresh logic here
    // For now, we'll just use the access token
    
    const response = await axios.post(`${process.env.BACKEND_URL}/tiktok/post-video`, {
      videoUrl,
      caption,
      accessToken: tokenToUse,
      refreshToken: refreshToken
    });
    
    return { success: true, data: response?.data };
  } catch (error) {
    console.error('Error posting to TikTok:', error?.message);
    throw new Error(`Failed to post to TikTok: ${error?.message}`);
  }
};

// Post to Twitter
const postToTwitter = async (videoUrl, text, accessToken, accessTokenSecret) => {
  try {
    console.log('Posting to Twitter with credentials:', {
      hasAccessToken: !!accessToken,
      hasAccessTokenSecret: !!accessTokenSecret
    });
    
    const response = await axios.post(`${process.env.BACKEND_URL}/twitter/post-media`, {
      videoUrl,
      text,
      accessToken,
      accessTokenSecret
    });
    
    console.log('Twitter API response:', response?.status, response?.statusText);
    
    if (!response?.data?.message) {
      console.warn('Twitter API response missing expected data:', response?.data);
    }
    
    return { success: true, data: response?.data };
  } catch (error) {
    console.error('Error posting to Twitter:', error?.message);
    if (error?.response) {
      console.error('Twitter API error response:', error.response.status, error.response.statusText);
      console.error('Twitter API error data:', error.response?.data);
    }
    throw new Error(`Failed to post to Twitter: ${error?.message}`);
  }
};

module.exports = {
  initScheduler
}; 