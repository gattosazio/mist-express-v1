const jwt = require('jsonwebtoken');
const User = require('../../../models/user'); // Up 3 levels to reach 'src'
const env = require('../../../config/env');

const authenticateUser = async (username) => {
    if (!username) {
        throw new Error('Username is required.');
    }

    // 1. Check if user exists
    let user = await User.findOne({
         where: { username } });

    // 2. Auto-Register (For development)
    if (!user) {
        user = await User.create({ 
            username, 
            clearanceLevel: username === 'admin' ? 'Level 5' : 'Level 1' 
        });
        console.log(`\x1b[33m[AUTH] New user registered: ${username}\x1b[0m`);
    }

    // 3. Mint the JWT badge
    const token = jwt.sign(
        { 
            id: user.id, 
            username: user.username, 
            clearance: user.clearanceLevel 
        },
        env.jwtSecret,
        { expiresIn: '8h' }
    );

    return {
        token,
        user: { 
            username: user.username, 
            clearance: user.clearanceLevel 
        }
    };
};

module.exports = { authenticateUser };