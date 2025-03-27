require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const Post = require('./models/Post');
const User = require('./models/User');

// Check the database connection
const verifyCollections = async () => {
  try {
    // Connect to MongoDB
    const conn = await connectDB();
    console.log('Connected to MongoDB successfully');
    console.log('Current database name:', conn.connection.name);
    console.log('Connection string:', process.env.MONGO_URI.replace(/:\/\/([^:]+):([^@]+)@/, '://***:***@')); // Hide credentials
    
    // Get all collections in the database
    const collections = await conn.connection.db.listCollections().toArray();
    console.log('Available collections:', collections.map(c => c.name));
    
    // Check the Post model's collection details
    const postModel = mongoose.model('Post');
    console.log('Post model collection:', postModel.collection.name);
    console.log('Post model collection namespace:', postModel.collection.namespace);
    
    // Check the User model's collection details
    const userModel = mongoose.model('User');
    console.log('User model collection:', userModel.collection.name);
    console.log('User model collection namespace:', userModel.collection.namespace);
    
    // Try to create a test post
    console.log('\nCreating a test post in the posts collection...');
    try {
      const testPost = new Post({
        video_url: 'https://example.com/test-video.mp4',
        post_description: 'Collection verification test',
        platforms: ['twitter'],
        userId: 'test-user-' + Date.now(),
        date: new Date()
      });
      
      const savedPost = await testPost.save();
      console.log('Test post created successfully with ID:', savedPost._id);
      
      // Clean up - remove the test post
      await Post.findByIdAndDelete(savedPost._id);
      console.log('Test post deleted successfully');
    } catch (error) {
      console.log('Error creating test post:', error.message);
    }
    
    console.log('\nVerification completed');
    process.exit(0);
  } catch (error) {
    console.error('Error during verification:', error);
    process.exit(1);
  }
};

// Run the verification
verifyCollections(); 