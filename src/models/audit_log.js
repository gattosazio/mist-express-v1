const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./user'); // Import User to link the tables together

const AuditLog = sequelize.define('AuditLog', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    query: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    response: {
        type: DataTypes.TEXT,
        allowNull: false,
    }
}, {
    tableName: 'audit_logs',
    timestamps: true, 
});

// Establish the Relationship: One User can have many Audit Logs
User.hasMany(AuditLog, { foreignKey: 'userId' });
AuditLog.belongsTo(User, { foreignKey: 'userId' });

module.exports = AuditLog;