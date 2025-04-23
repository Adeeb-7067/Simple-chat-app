const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configure Socket.IO with CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());

// Store connected users
const users = new Map();

// Clear all users on server start
const clearAllUsers = () => {
  users.clear();
  console.log('All users cleared on server start');
};

// Call clearAllUsers when server starts
clearAllUsers();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connectedUsers: users.size,
    serverStartTime: new Date().toISOString()
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Send immediate connection confirmation
  socket.emit('connected', { id: socket.id });

  // Handle user joining
  socket.on('join', (username) => {
    try {
      if (!username || username.trim() === '') {
        socket.emit('error', { message: 'Username cannot be empty' });
        return;
      }

      // Check if username is already taken
      const existingUser = Array.from(users.values()).find(u => u === username);
      if (existingUser) {
        socket.emit('error', { message: 'Username is already taken' });
        return;
      }

      // Remove any existing connection for this username
      for (const [id, name] of users.entries()) {
        if (name === username) {
          users.delete(id);
          io.to(id).emit('error', { message: 'You have been disconnected because you logged in from another device' });
          io.to(id).disconnect(true);
        }
      }

      users.set(socket.id, username);
      socket.emit('joined', { username, id: socket.id });
      io.emit('userJoined', { username, id: socket.id });
      io.emit('userList', Array.from(users.values()));
      console.log(`${username} joined the chat`);
    } catch (error) {
      console.error('Error in join handler:', error);
      socket.emit('error', { message: 'Failed to join chat' });
    }
  });

  // Handle incoming messages
  socket.on('message', (message) => {
    try {
      const username = users.get(socket.id);
      if (!username) {
        socket.emit('error', { message: 'You must join the chat first' });
        return;
      }

      if (!message || message.trim() === '') {
        socket.emit('error', { message: 'Message cannot be empty' });
        return;
      }

      const messageData = {
        id: Date.now().toString(),
        text: message,
        sender: username,
        timestamp: new Date().toLocaleTimeString(),
      };

      io.emit('message', messageData);
      console.log(`Message from ${username}: ${message}`);
    } catch (error) {
      console.error('Error in message handler:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle typing status
  socket.on('typing', () => {
    const username = users.get(socket.id);
    if (username) {
      socket.broadcast.emit('userTyping', username);
    }
  });

  // Handle stop typing
  socket.on('stopTyping', () => {
    const username = users.get(socket.id);
    if (username) {
      socket.broadcast.emit('userStoppedTyping', username);
    }
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    try {
      const username = users.get(socket.id);
      if (username) {
        users.delete(socket.id);
        io.emit('userLeft', { username, id: socket.id });
        io.emit('userList', Array.from(users.values()));
        console.log(`${username} left the chat (${reason})`);
      }
    } catch (error) {
      console.error('Error in disconnect handler:', error);
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    socket.emit('error', { message: 'An error occurred' });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  io.emit('serverShutdown', { message: 'Server is shutting down' });
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  io.emit('serverShutdown', { message: 'Server is shutting down' });
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log('All previous user data has been cleared');
}); 