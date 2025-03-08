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
      console.log('Running scheduler check at', now.toISOString());
      
      const posts = await Post.find({
        isScheduled: true,
        scheduledDate: { $lte: now },
        status: 'pending'
      }).lean(); // Using lean() to get plain JS objects for better debugging
      
      if (posts.length > 0) {
        console.log(`Found ${posts.length} scheduled posts to publish`);
        
        // Process each post
        for (const post of posts) {
          try {
            // Debug log the post structure
            console.log('Processing scheduled post:', {
              id: post._id,
              platforms: post.platforms,
              has_tiktok_accounts: !!post.tiktok_accounts,
              tiktok_accounts_count: post.tiktok_accounts?.length || 0,
              has_legacy_tiktok: !!post.tiktok_access_token,
              has_twitter: !!post.twitter_access_token
            });
            
            if (post.tiktok_accounts) {
              console.log('TikTok accounts found in post:', 
                post.tiktok_accounts.map(acc => ({
                  openId: acc.openId,
                  hasAccessToken: !!acc.accessToken,
                  hasRefreshToken: !!acc.refreshToken
                }))
              );
            }
            
            // Update status to processing
            await Post.updateOne({ _id: post._id }, { status: 'processing' });
            
            // Process the post
            await processPost(post);
            
            // Update status to completed
            await Post.updateOne({ _id: post._id }, { status: 'completed' });
            
            console.log(`Successfully published scheduled post: ${post._id}`);
          } catch (error) {
            console.error(`Error publishing scheduled post ${post._id}:`, error?.message);
            
            // Update status to failed
            await Post.updateOne({ _id: post._id }, { status: 'failed' });
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
    tiktok_accounts,
    tiktok_access_token,
    tiktok_refresh_token,
    twitter_access_token,
    twitter_access_token_secret
  } = post;
  
  if (!video_url || !platforms || platforms.length === 0) {
    throw new Error('Invalid post data');
  }
  
  console.log('Post data for processing:', {
    video_url: !!video_url,
    post_description: !!post_description,
    platforms,
    has_tiktok_accounts: !!tiktok_accounts,
    tiktok_accounts_count: tiktok_accounts?.length || 0,
    has_legacy_tiktok: !!tiktok_access_token,
    has_twitter: !!twitter_access_token && !!twitter_access_token_secret
  });
  
  const results = {};
  
  // Process each platform sequentially
  for (const platform of platforms) {
    try {
      console.log(`Processing platform: ${platform}`);
      
      if (platform === 'tiktok') {
        // Check if we have the new format (tiktok_accounts array)
        if (tiktok_accounts && Array.isArray(tiktok_accounts) && tiktok_accounts.length > 0) {
          // Post to all selected TikTok accounts
          console.log(`Found ${tiktok_accounts.length} TikTok accounts to post to`);
          results.tiktok = [];
          
          // Debug log each account structure
          tiktok_accounts.forEach((acc, idx) => {
            console.log(`TikTok account ${idx + 1}:`, {
              openId: acc.openId,
              hasAccessToken: !!acc.accessToken,
              hasRefreshToken: !!acc.refreshToken
            });
          });
          
          for (const account of tiktok_accounts) {
            try {
              console.log(`Posting to TikTok account with ID ${account.openId}`);
              const tiktokResult = await postToTikTok(
                video_url, 
                post_description, 
                account.accessToken, 
                account.refreshToken
              );
              results.tiktok.push({ 
                success: true, 
                accountId: account.openId,
                ...tiktokResult 
              });
              console.log(`TikTok posting completed successfully for account ${account.openId}`);
            } catch (accountError) {
              console.error(`Error posting to TikTok account ${account.openId}:`, accountError?.message);
              results.tiktok.push({ 
                success: false, 
                accountId: account.openId,
                error: accountError?.message 
              });
            }
          }
        } 
        // Fallback to legacy single account
        else if (tiktok_access_token) {
          console.log('Using legacy TikTok credentials format');
          try {
            const tiktokResult = await postToTikTok(
              video_url, 
              post_description, 
              tiktok_access_token, 
              tiktok_refresh_token
            );
            results.tiktok = [{ 
              success: true, 
              accountId: 'legacy',
              ...tiktokResult 
            }];
            console.log('TikTok posting completed successfully using legacy format');
          } catch (accountError) {
            console.error('Error posting to TikTok using legacy format:', accountError?.message);
            results.tiktok = [{ 
              success: false, 
              accountId: 'legacy',
              error: accountError?.message 
            }];
          }
        } else {
          console.warn('No TikTok credentials found for scheduled post');
        }
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
          results.twitter = { success: false, error: twitterError?.message };
        }
      } else if (platform === 'twitter') {
        console.warn('Twitter credentials are missing');
        results.twitter = { success: false, error: 'Twitter credentials are missing' };
      }
    } catch (error) {
      console.error(`Error processing platform ${platform}:`, error?.message);
      results[platform] = { success: false, error: error?.message };
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
    const response = await axios.post(`${process.env.BACKEND_URL}/tiktok/post-video`, {
      videoUrl,
      caption,
      accessToken,
      refreshToken
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
    
    const response = await axios.post(`${process.env.BACKEND_URL}/twitter/post-video`, {
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
  initScheduler,
  processPost  // Export processPost for testing
}; 