const jwt = require('jsonwebtoken');
const env = require('../config/env');

const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Access Denied: No security badge provided.' 
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decodedPayload = jwt.verify(token, env.jwtSecret);
        req.user = decodedPayload; // Attach user data to the request
        next(); // Let them pass
    } catch (error) {
        console.error('\x1b[31m[SECURITY] Invalid or expired token attempt.\x1b[0m');
        return res.status(403).json({ error: 'Access Denied: Invalid or expired badge.' });
    }
};

module.exports = requireAuth;