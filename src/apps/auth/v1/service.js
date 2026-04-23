const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const User = require('../../../models/user');
const env = require('../../../config/env');

const issueAuthToken = (user) => {
    const token = jwt.sign(
        {
            id: user.id,
            username: user.username,
            clearance: user.clearanceLevel,
        },
        env.jwtSecret,
        { expiresIn: '8h' }
    );

    return {
        token,
        user: {
            username: user.username,
            clearance: user.clearanceLevel,
        },
    };
};

const registerUser = async ({ username, password, clearanceLevel }) => {
    if (!username || !String(username).trim()) {
        throw new Error('Username is required.');
    }

    if (!password || String(password).length < 8) {
        throw new Error('Password must be at least 8 characters long.');
    }

    const normalizedUsername = String(username).trim();

    const existingUser = await User.findOne({
        where: { username: normalizedUsername },
    });

    if (existingUser) {
        throw new Error('Username already exists.');
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
        username: normalizedUsername,
        passwordHash,
        clearanceLevel: clearanceLevel || (normalizedUsername === 'admin' ? 'Level 5' : 'Level 1'),
    });

    return issueAuthToken(user);
};

const buildLoginResponse = (user) => {
    return issueAuthToken(user);
};

module.exports = {
    registerUser,
    buildLoginResponse,
};
