require('dotenv').config();
const axios = require('axios');

const API_URL = `http://localhost:${process.env.PORT || 3335}`;

// Function to test the posts API
const testPostsAPI = async () => {
  try {
    console.log('Testing Posts API...');
    console.log(`API URL: ${API_URL}`);
    
    // Test creating a post
    console.log('\n1. Creating a new post...');
    const createResponse = await axios.post(`${API_URL}/posts`, {
      video_url: 'https://example.com/test-video.mp4',
      post_description: 'This is a test post created via API',
      platforms: ['twitter', 'tiktok'],
      userId: 'api-test-user',
      isScheduled: false
    });
    
    console.log('Post created successfully:');
    console.log(JSON.stringify(createResponse.data, null, 2));
    
    const postId = createResponse.data._id;
    
    // Test getting all posts
    console.log('\n2. Getting all posts...');
    const getAllResponse = await axios.get(`${API_URL}/posts`);
    console.log(`Total posts: ${getAllResponse.data.length}`);
    
    // Test getting a single post
    console.log('\n3. Getting the created post...');
    const getOneResponse = await axios.get(`${API_URL}/posts/${postId}`);
    console.log('Post retrieved successfully:');
    console.log(JSON.stringify(getOneResponse.data, null, 2));
    
    // Test updating a post
    console.log('\n4. Updating the post...');
    const updateResponse = await axios.put(`${API_URL}/posts/${postId}`, {
      post_description: 'This post was updated via API',
      status: 'completed'
    });
    console.log('Post updated successfully:');
    console.log(JSON.stringify(updateResponse.data, null, 2));
    
    // Test getting posts by user ID
    console.log('\n5. Getting posts by user ID...');
    const userPostsResponse = await axios.get(`${API_URL}/posts/user/api-test-user`);
    console.log(`Total posts for user: ${userPostsResponse.data.length}`);
    
    // Test deleting the post
    console.log('\n6. Deleting the post...');
    const deleteResponse = await axios.delete(`${API_URL}/posts/${postId}`);
    console.log('Post deleted successfully:');
    console.log(JSON.stringify(deleteResponse.data, null, 2));
    
    console.log('\nAPI tests completed successfully!');
  } catch (error) {
    console.error('Error testing API:', error?.response?.data || error?.message);
  }
};

// Run the tests
testPostsAPI();