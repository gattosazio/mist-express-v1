const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./user');

const AuditLog = sequelize.define(
    'AuditLog',
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        auth_user_id: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        network_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        participant_identity: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        channel: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'voice',
        },
        query: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        response: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        confidence: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        escalation_needed: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        policy_type: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        citations: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: [],
        },
        retrieved_chunks: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: [],
        },
        metadata: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: {},
        },
    },
    {
        tableName: 'audit_logs',
        timestamps: true,
        underscored: true,
    }
);

User.hasMany(AuditLog, { foreignKey: 'userId' });
AuditLog.belongsTo(User, { foreignKey: 'userId' });

module.exports = AuditLog;
