require('dotenv').config();
const connectDB = require('./config/db');
const Post = require('./models/Post');

// Function to create a dummy post
const createDummyPost = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Create a dummy post
    const dummyPost = {
      video_url: 'https://example.com/sample-video.mp4',
      post_description: 'This is a test post created by the MongoDB test script',
      platforms: ['twitter', 'tiktok'],
      userId: 'test-user-123',
      date: new Date()
    };
    
    // Save the post to the database
    const newPost = await Post.create(dummyPost);
    
    console.log('Dummy post created successfully:');
    console.log(JSON.stringify(newPost, null, 2));
    
    // Find all posts to verify
    const allPosts = await Post.find();
    console.log(`\nTotal posts in database: ${allPosts.length}`);
    console.log('All posts:');
    console.log(JSON.stringify(allPosts, null, 2));
    
    console.log('\nMongoDB test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error in MongoDB test:', error.message);
    process.exit(1);
  }
};

// Run the test
createDummyPost(); 