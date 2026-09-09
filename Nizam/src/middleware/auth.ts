import { Request, Response, NextFunction } from 'express';
const jwt = require('jsonwebtoken');

// Extend Express Request type to include user property
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        [key: string]: any;
      };
    }
  }
}

export const authenticateJwt = (req: Request, res: Response, next: NextFunction) => {
  // Skip JWT verification in development mode
  if (process.env.NODE_ENV !== 'production') {
    // Use a valid 24-char hex string for dev mode (ObjectId compatible)
    req.user = { userId: '000000000000000000000001', email: 'dev@local.com', isDev: true };
    return next();
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  const token = authHeader.substring(7);
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.error('JWT_SECRET is not set in environment variables');
    return res.status(500).json({ success: false, message: 'Server configuration error.' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};
