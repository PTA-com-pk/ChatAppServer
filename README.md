# Chat App Server

Backend server for the chat application built with Node.js, Express, and Socket.IO.

## Features

- **JWT Authentication**: Secure user authentication and authorization
- **Real-time Chat**: WebSocket-based real-time messaging using Socket.IO
- **File Uploads**: Support for various file types with size limits
- **User Management**: User registration, login, and profile management
- **Active Users**: Real-time tracking of online users
- **Media Support**: Support for images, videos, audio, and documents
- **WebRTC Signaling**: Support for video/audio calls

## Project Structure

```
server/
├── index.js                 # Main server entry point
├── package.json            # Server dependencies and scripts
├── .env                    # Environment variables
├── .gitignore             # Git ignore rules
├── middleware/
│   └── auth.js            # JWT authentication middleware
├── routes/
│   ├── auth.js            # Authentication routes (login, register)
│   └── chat.js            # Chat-related routes (file upload, history)
├── socket/
│   └── socketHandler.js   # Socket.IO connection and event handling
└── uploads/               # Directory for uploaded files
```

## Installation

1. Navigate to the server directory:
   ```bash
   cd server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create and configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

## Configuration

### Environment Variables

Create a `.env` file in the server directory with the following variables:

```env
# Server Configuration
JWT_SECRET=your_jwt_secret_key_here_change_this_in_production
PORT=5000
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:3000

# File Upload Configuration
MAX_FILE_SIZE=1000000000
UPLOAD_PATH=./uploads
```

### Important Security Notes

- **Change the JWT_SECRET**: Use a strong, random secret key in production
- **Update CORS_ORIGIN**: Set to your frontend URL in production
- **File Upload Limits**: Adjust MAX_FILE_SIZE as needed (default: 1GB)

## Running the Server

### Development Mode
```bash
npm run dev
```
This will start the server with nodemon for automatic restarts on file changes.

### Production Mode
```bash
npm start
```

The server will start on the port specified in your `.env` file (default: 5000).

## API Endpoints

### Authentication Routes (`/api/auth`)

- `POST /register` - Register a new user
- `POST /login` - Login with email and password
- `GET /me` - Get current user information

### Chat Routes (`/api/chat`)

- `POST /upload` - Upload a file
- `GET /history` - Get chat history (placeholder)

## Socket.IO Events

### Client to Server Events

- `authenticate` - Authenticate with JWT token
- `sendMessage` - Send a new message
- `typing` - Send typing indicator
- `callRequest` - Request a video/audio call
- `callResponse` - Respond to a call request
- `webrtc-signal` - WebRTC signaling data

### Server to Client Events

- `authError` - Authentication error
- `userJoined` - User joined the chat
- `userLeft` - User left the chat
- `activeUsers` - List of active users
- `newMessage` - New message received
- `messageHistory` - Chat message history
- `userTyping` - User typing indicator
- `incomingCall` - Incoming call notification
- `callResponse` - Call response
- `webrtc-signal` - WebRTC signaling data

## File Upload Support

The server supports various file types:

- **Images**: jpg, jpeg, png, gif, webp, svg
- **Videos**: mp4, avi, mov, wmv, flv, webm
- **Audio**: mp3, wav, ogg, aac, flac
- **Documents**: pdf, doc, docx, txt
- **Archives**: zip, rar, 7z
- **Spreadsheets**: xls, xlsx, csv
- **Presentations**: ppt, pptx

## Development

### Adding New Routes

1. Create a new route file in the `routes/` directory
2. Import and use the route in `index.js`
3. Add authentication middleware if needed

### Adding New Socket Events

1. Add event handlers in `socket/socketHandler.js`
2. Update the client-side code to handle the new events

## Production Deployment

1. Set `NODE_ENV=production` in your `.env` file
2. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start index.js --name chat-server
   ```
3. Set up a reverse proxy (nginx) for SSL termination
4. Configure proper CORS origins
5. Use a strong JWT secret
6. Set up proper logging and monitoring

## Security Considerations

- Always use HTTPS in production
- Implement rate limiting for API endpoints
- Validate and sanitize all user inputs
- Use proper CORS configuration
- Implement proper error handling
- Consider using a database instead of in-memory storage
- Add request logging and monitoring

## Troubleshooting

### Common Issues

1. **Port already in use**: Change the PORT in your `.env` file
2. **CORS errors**: Update CORS_ORIGIN in your `.env` file
3. **File upload fails**: Check uploads directory permissions
4. **JWT errors**: Verify JWT_SECRET is set correctly

### Logs

The server logs important events to the console. In production, consider using a proper logging library like Winston.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see the main project README for details.
