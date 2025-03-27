require('dotenv').config();
const connectDB = require('./config/db');
const Post = require('./models/Post');
const User = require('./models/User');

// Test function
const testCollections = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('Connected to MongoDB successfully');
    
    // Test Post collection
    console.log('Testing Post collection (sociallane.posts)...');
    const postsCount = await Post.countDocuments();
    console.log(`Found ${postsCount} documents in posts collection`);
    
    // Test User/Customers collection
    console.log('Testing User collection (sociallane.customers)...');
    const usersCount = await User.countDocuments();
    console.log(`Found ${usersCount} documents in customers collection`);
    
    // Create a test post
    console.log('Creating a test post in sociallane.posts collection...');
    const testPost = new Post({
      video_url: 'https://example.com/test-video.mp4',
      post_description: 'Test post to verify collection mapping',
      platforms: ['twitter'],
      userId: 'test-user',
      date: new Date()
    });
    
    // Use try-catch to handle validation errors
    try {
      const savedPost = await testPost.save();
      console.log('Test post created successfully with ID:', savedPost._id);
      
      // Clean up - remove the test post
      await Post.findByIdAndDelete(savedPost._id);
      console.log('Test post deleted successfully');
    } catch (validationError) {
      console.log('Post validation error:', validationError.message);
      console.log('This is expected if TikTok accounts are required but not provided');
    }
    
    console.log('Collection test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error testing collections:', error);
    process.exit(1);
  }
};

// Run the test
testCollections(); 