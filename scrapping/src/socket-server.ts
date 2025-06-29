import "dotenv/config";
import { SocketServer } from './services/SocketServer.js';
import logger from './utils/logger.js';

async function startSocketServer() {
  try {
    const port = parseInt(process.env.SOCKET_PORT || '3001');
    const server = new SocketServer(port);
    
    server.start();
    
    logger.info(`🚀 Socket.IO server started on port ${port}`);
    logger.info('📡 Ready to receive exploration commands from frontend');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      logger.info('🛑 Shutting down Socket.IO server...');
      server.stop();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('❌ Failed to start Socket.IO server', { error });
    process.exit(1);
  }
}

startSocketServer(); 