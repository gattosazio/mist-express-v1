const { Sequelize } = require('sequelize');
const env = require('./env'); // Pulling in our strict environment variables

// Initialize Sequelize with your Database URL
const sequelize = new Sequelize(env.databaseUrl, {
    dialect: 'postgres',
    logging: false, // Change to console.log if you want to see every SQL query printed in the terminal
});

// A helper function to verify the connection
const testDbConnection = async () => {
    try {
        await sequelize.authenticate();
        console.log('\x1b[36m[DATABASE] PostgreSQL connection established successfully.\x1b[0m');
    } catch (error) {
        console.error('\x1b[31m[FATAL ERROR] Unable to connect to the PostgreSQL database:\x1b[0m\n', error.message);
        process.exit(1); // Kill the server if the database is down
    }
};

module.exports = { sequelize, testDbConnection };