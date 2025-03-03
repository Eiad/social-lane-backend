# Social Lane Backend

Backend for the Social Lane application, which allows users to create and schedule posts for various social media platforms.

## MongoDB Integration

The application uses MongoDB Atlas for data storage. The connection is configured in the `.env` file with the following variable:

```
MONGO_URI=mongodb+srv://shaiboba:nFnbs061A@sociallane.6pv2f.mongodb.net/?retryWrites=true&w=majority&appName=sociallane
```

## Database Models

### Post

The Post model represents a social media post with the following fields:

- `video_url`: URL of the video to be posted
- `video_id`: ID of the video (optional)
- `post_description`: Description/caption for the post
- `platforms`: Array of platforms to post to (twitter, tiktok, etc.)
- `userId`: ID of the user who created the post
- `isScheduled`: Whether the post is scheduled for later
- `scheduledDate`: Date when the post should be published (if scheduled)
- `status`: Status of the post (pending, processing, completed, failed)
- `date`: Date when the post was created
- `createdAt`: Timestamp when the record was created
- `updatedAt`: Timestamp when the record was last updated

## API Endpoints

### Posts

- `GET /posts`: Get all posts
- `GET /posts/:id`: Get a specific post by ID
- `GET /posts/user/:userId`: Get all posts for a specific user
- `POST /posts`: Create a new post
- `PUT /posts/:id`: Update an existing post
- `DELETE /posts/:id`: Delete a post

## Testing

Two test scripts are provided to test the MongoDB integration:

1. `test-mongodb.js`: Tests the MongoDB connection and creates a dummy post directly using Mongoose
2. `test-posts-api.js`: Tests the API endpoints for posts (create, read, update, delete)

To run the tests:

```bash
node test-mongodb.js
node test-posts-api.js
```

## Running the Application

To start the server in development mode:

```bash
npm run dev
```

To start the server in production mode:

```bash
npm start
``` 