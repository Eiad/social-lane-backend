/**
 * Migration script to convert existing users from old role system (Free/Pro)
 * to new role system (Starter/Launch/Rise/Scale)
 * 
 * Usage: 
 * - Make sure MongoDB connection is configured correctly
 * - Run with: node scripts/migrateUserRoles.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

// Map old roles to new roles
const ROLE_MAPPING = {
  'Free': 'Starter',
  'Pro': 'Launch'
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

const migrateUserRoles = async () => {
  try {
    // Connect to the database
    const conn = await connectDB();
    
    console.log('Starting user role migration...');
    
    // Find users with old roles
    const users = await User.find({
      role: { $in: ['Free', 'Pro'] }
    });
    
    console.log(`Found ${users.length} users with old roles to migrate`);
    
    // Update each user
    let updated = 0;
    for (const user of users) {
      const oldRole = user.role;
      const newRole = ROLE_MAPPING[oldRole] || 'Starter'; // Default to Starter if role not found
      
      console.log(`Migrating user ${user.uid} from ${oldRole} to ${newRole}`);
      
      // Update user role
      await User.updateOne(
        { _id: user._id },
        { role: newRole }
      );
      
      updated++;
    }
    
    console.log(`Migration completed successfully! Updated ${updated} users.`);
    
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
    
  } catch (error) {
    console.error('Error migrating user roles:', error);
    // Close database connection in case of error
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('Database connection closed due to error');
    }
  }
};

// Run the migration script immediately
migrateUserRoles(); 