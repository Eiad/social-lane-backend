require('dotenv').config();
const { TwitterApi } = require('twitter-api-v2');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Twitter API credentials from environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;

// Test video URL
const TEST_VIDEO_URL = 'https://media.mindio.chat/sample-video.mp4';

async function testTwitterApi() {
  try {
    console.log('Testing Twitter API integration...');
    
    // Create a Twitter client with the provided credentials
    const twitterClient = new TwitterApi({
      appKey: TWITTER_API_KEY,
      appSecret: TWITTER_API_SECRET,
      accessToken: TWITTER_ACCESS_TOKEN,
      accessSecret: TWITTER_ACCESS_TOKEN_SECRET,
    });
    
    // Verify credentials
    console.log('Verifying credentials...');
    const currentUser = await twitterClient.v2.me();
    console.log('Credentials verified. Current user:', currentUser?.data);
    
    // Test downloading a video
    console.log('Testing video download from URL:', TEST_VIDEO_URL);
    let videoBuffer;
    
    try {
      const videoResponse = await axios.get(TEST_VIDEO_URL, { 
        responseType: 'arraybuffer',
        timeout: 30000,
      });
      
      videoBuffer = Buffer.from(videoResponse?.data);
      console.log('Video downloaded successfully. Size:', videoBuffer?.length, 'bytes');
    } catch (downloadError) {
      console.error('Error downloading video:', downloadError?.message);
      return;
    }
    
    // Create a temporary file path for the video
    const tempFilePath = path.join(__dirname, 'temp', `test-twitter-video-${Date.now()}.mp4`);
    
    try {
      // Ensure the temp directory exists
      await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
      
      // Write the video buffer to a temporary file
      await fs.writeFile(tempFilePath, videoBuffer);
      console.log('Video saved to temporary file:', tempFilePath);
    } catch (fileError) {
      console.error('Error saving video to temporary file:', fileError?.message);
      return;
    }
    
    // Upload the media to Twitter
    console.log('Uploading media to Twitter...');
    let mediaId;
    
    try {
      // Upload the media to Twitter
      mediaId = await twitterClient.v1.uploadMedia(tempFilePath, {
        mimeType: 'video/mp4',
        type: 'tweet_video',
      });
      
      console.log('Media uploaded successfully. Media ID:', mediaId);
    } catch (uploadError) {
      console.error('Error uploading media to Twitter:', uploadError?.message);
      
      // Clean up the temporary file
      try {
        await fs.unlink(tempFilePath);
        console.log('Temporary file deleted');
      } catch (cleanupError) {
        console.error('Error deleting temporary file:', cleanupError?.message);
      }
      
      return;
    }
    
    // Post a test tweet with the media
    console.log('Posting test tweet with media...');
    
    try {
      // Post the tweet with the media
      const tweet = await twitterClient.v2.tweet({
        text: 'This is a test tweet with media from Social Lane!',
        media: { media_ids: [mediaId] },
      });
      
      console.log('Tweet posted successfully:', tweet);
    } catch (tweetError) {
      console.error('Error posting tweet:', tweetError?.message);
    }
    
    // Clean up the temporary file
    try {
      await fs.unlink(tempFilePath);
      console.log('Temporary file deleted');
    } catch (cleanupError) {
      console.error('Error deleting temporary file:', cleanupError?.message);
    }
    
    console.log('Twitter API integration test completed.');
  } catch (error) {
    console.error('Error testing Twitter API integration:', error?.message);
    console.error('Error stack:', error?.stack);
  }
}

// Run the test
testTwitterApi().catch(console.error); 