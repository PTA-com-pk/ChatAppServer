#!/bin/bash

# Chat App Server Startup Script

echo "Starting Chat App Server..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Warning: .env file not found!"
    echo "Using environment variables or defaults..."
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Set environment
export NODE_ENV=${NODE_ENV:-development}

# Start the server based on environment
if [ "$NODE_ENV" = "production" ]; then
    echo "Starting server in production mode..."
    npm run start:prod
else
    echo "Starting server in development mode..."
    npm run dev
fi
