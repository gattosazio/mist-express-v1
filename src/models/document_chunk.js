const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DocumentChunk = sequelize.define('DocumentChunk', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    document_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    network_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    chunk_index: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    section_title: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    embedding: {
        type: DataTypes.ARRAY(DataTypes.FLOAT),
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
    }
    }, {
    tableName: 'document_chunks',
    timestamps: true,
    underscored: true,

});

module.exports = DocumentChunk;
