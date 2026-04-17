const ragService = require('./service');

const ingestDocument = async (req, res) => {
    try {
        // console.log('[RAG INGEST HEADERS]', req.headers);
        // console.log('[RAG INGEST BODY]', req.body);
        // console.log('[RAG INGEST BODY TYPE]', typeof req.body);

        const result = await ragService.ingestDocument(req.body || {});

        res.status(201).json({
            message: 'Document ingested successfully.',
            ...result,
        });
    } catch (error) {
        res.status(400).json({
            error: error.message || 'Failed to ingest document.',
        });
    }
};

const askPolicyQuestion = async (req, res) => {
    try {
        const result = await ragService.askPolicyQuestion(req.body || {});

        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({
            error: error.message || 'Failed to answer policy question.',
        });
    }
};

module.exports = {
    ingestDocument,
    askPolicyQuestion,
};
