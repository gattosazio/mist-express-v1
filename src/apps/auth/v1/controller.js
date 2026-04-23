const passport = require('passport');
const authService = require('./service');

const login = async (req, res, next) => {
    passport.authenticate('local', { session: false }, async (error, user, info) => {
        try {
            if (error) {
                return next(error);
            }

            if (!user) {
                return res.status(401).json({
                    error: info?.message || 'Invalid username or password.',
                });
            }

            const result = authService.buildLoginResponse(user);

            return res.status(200).json({
                message: 'Authentication successful',
                ...result,
            });
        } catch (err) {
            return next(err);
        }
    })(req, res, next);
};

const register = async (req, res) => {
    try {
        const { username, password, clearanceLevel } = req.body;

        const result = await authService.registerUser({
            username,
            password,
            clearanceLevel,
        });

        res.status(201).json({
            message: 'User registered successfully',
            ...result,
        });
    } catch (error) {
        console.error('[AUTH ERROR]', error.message);

        if (
            error.message === 'Username is required.' ||
            error.message === 'Password must be at least 8 characters long.' ||
            error.message === 'Username already exists.'
        ) {
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({ error: 'Internal server error during registration.' });
    }
};

module.exports = {
    login,
    register,
};
