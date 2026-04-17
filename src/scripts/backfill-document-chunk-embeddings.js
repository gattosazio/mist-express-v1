require('dotenv').config();

const { sequelize } = require('../config/database');
const DocumentChunk = require('../models/document_chunk');
const { embedTexts } = require('../apps/rag/v1/embedder');
const {
    ensureVectorSchema,
    upsertChunkEmbeddings,
} = require('../apps/rag/v1/vectorStore');

const BATCH_SIZE = 25;

const backfillEmbeddings = async () => {
    console.log('\x1b[36m[BACKFILL]\x1b[0m Starting document chunk embedding backfill...');

    await sequelize.authenticate();
    await ensureVectorSchema();

    const chunks = await DocumentChunk.findAll({
        attributes: ['id', 'document_id', 'content'],
        order: [['id', 'ASC']],
    });

    if (!chunks.length) {
        console.log('\x1b[33m[BACKFILL]\x1b[0m No document chunks found.');
        return;
    }

    console.log(`\x1b[36m[BACKFILL]\x1b[0m Found ${chunks.length} chunks.`);

    let processed = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const texts = batch.map((chunk) => chunk.content);

        console.log(
            `\x1b[36m[BACKFILL]\x1b[0m Embedding batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} chunks)...`
        );

        const embeddings = await embedTexts(texts);

        await upsertChunkEmbeddings(
            batch.map((chunk, index) => ({
                chunkId: chunk.id,
                documentId: chunk.document_id,
                embedding: embeddings[index],
            }))
        );

        processed += batch.length;

        console.log(`\x1b[32m[BACKFILL]\x1b[0m Processed ${processed}/${chunks.length} chunks.`);
    }

    console.log('\x1b[32m[BACKFILL COMPLETE]\x1b[0m All chunk embeddings have been generated.');
};

backfillEmbeddings()
    .catch((error) => {
        console.error('\x1b[31m[BACKFILL ERROR]\x1b[0m', error);
        process.exit(1);
    })
    .finally(async () => {
        await sequelize.close();
    });