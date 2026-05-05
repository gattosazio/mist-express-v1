const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Document = sequelize.define('Document', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    network_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    source_url: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    policy_type: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    version: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    effective_date: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
    },
    created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    }
}, {
    tableName: 'documents',
    timestamps: true,
    underscored: true,
});

module.exports = Document;
