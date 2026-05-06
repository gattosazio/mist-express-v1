const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true, // No two users can have the same username
    },
    supabase_user_id: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    passwordHash: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    clearanceLevel: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Level 1',
    }
}, {
    tableName: 'users',
    timestamps: true, // Automatically adds createdAt and updatedAt columns
});

module.exports = User;
