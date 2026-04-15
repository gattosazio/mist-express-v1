const authService = require('./service');

const login = async (req, res) => {
    try {
        const { username } = req.body;

        // Call the service to do the hard work
        const result = await authService.authenticateUser(username);

        // Send the successful response
        res.status(200).json({
            message: 'Authentication successful',
            ...result 
        });

    } catch (error) {
        console.error('[AUTH ERROR]', error.message);
        
        if (error.message === 'Username is required.') {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: 'Internal server error during authentication.' });
    }
};

module.exports = { login };