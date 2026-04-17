const { QueryTypes } = require('sequelize');
const pgvector = require('pgvector');

const { sequelize } = require('../../../config/database');

let ensureVectorSchemaPromise = null;

const ensureVectorSchema = async () => {
    if (!ensureVectorSchemaPromise) {
        ensureVectorSchemaPromise = (async () => {
            await sequelize.query('CREATE EXTENSION IF NOT EXISTS vector;');

            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS document_chunk_embeddings (
                    chunk_id INTEGER PRIMARY KEY REFERENCES document_chunks(id) ON DELETE CASCADE,
                    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                    embedding vector NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            `);

            await sequelize.query(`
                CREATE INDEX IF NOT EXISTS idx_document_chunk_embeddings_document_id
                ON document_chunk_embeddings (document_id);
            `);
        })();
    }

    return ensureVectorSchemaPromise;
};

const upsertChunkEmbedding = async ({ chunkId, documentId, embedding }) => {
    await ensureVectorSchema();

    await sequelize.query(
        `
        INSERT INTO document_chunk_embeddings (chunk_id, document_id, embedding, created_at, updated_at)
        VALUES (:chunkId, :documentId, CAST(:embedding AS vector), NOW(), NOW())
        ON CONFLICT (chunk_id)
        DO UPDATE SET
            document_id = EXCLUDED.document_id,
            embedding = EXCLUDED.embedding,
            updated_at = NOW();
        `,
        {
            replacements: {
                chunkId,
                documentId,
                embedding: pgvector.toSql(embedding),
            },
        }
    );
};

const upsertChunkEmbeddings = async (rows = []) => {
    for (const row of rows) {
        await upsertChunkEmbedding(row);
    }
};

const searchSemanticChunks = async ({
    embedding,
    policyType = null,
    topK = 5,
    minSimilarity = 0.2,
}) => {
    await ensureVectorSchema();

    const rows = await sequelize.query(
        `
        SELECT
            c.id,
            c.document_id,
            c.chunk_index,
            c.section_title,
            c.content,
            c.metadata,
            d.title AS document_title,
            d.policy_type,
            d.version,
            d.source_url,
            1 - (e.embedding <=> CAST(:queryEmbedding AS vector)) AS similarity
        FROM document_chunk_embeddings e
        INNER JOIN document_chunks c ON c.id = e.chunk_id
        INNER JOIN documents d ON d.id = e.document_id
        WHERE d.status IN ('active', 'published')
          AND (:policyType IS NULL OR d.policy_type = :policyType)
          AND 1 - (e.embedding <=> CAST(:queryEmbedding AS vector)) >= :minSimilarity
        ORDER BY e.embedding <=> CAST(:queryEmbedding AS vector)
        LIMIT :topK;
        `,
        {
            replacements: {
                queryEmbedding: pgvector.toSql(embedding),
                policyType,
                minSimilarity,
                topK,
            },
            type: QueryTypes.SELECT,
        }
    );

    return rows;
};

module.exports = {
    ensureVectorSchema,
    upsertChunkEmbedding,
    upsertChunkEmbeddings,
    searchSemanticChunks,
};
