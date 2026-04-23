const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');

const User = require('../models/user');

passport.use(
    new LocalStrategy(async (username, password, done) => {
        try {
            if (!username || !password) {
                return done(null, false, { message: 'Username and password are required.' });
            }

            const user = await User.findOne({ where: { username } });

            if (!user || !user.passwordHash) {
                return done(null, false, { message: 'Invalid username or password.' });
            }

            const isValidPassword = await bcrypt.compare(password, user.passwordHash);

            if (!isValidPassword) {
                return done(null, false, { message: 'Invalid username or password.' });
            }

            return done(null, user);
        } catch (error) {
            return done(error);
        }
    })
);

module.exports = passport;
