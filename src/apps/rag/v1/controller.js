const ragService = require('./service');
const { extractDocumentText } = require('./extractor');

const ingestDocument = async (req, res) => {
    try {
        const result = await ragService.ingestDocument({
            ...(req.body || {}),
            networkId: req.network.id,
        });

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

const ingestDocumentFile = async (req, res) => {
    try {
        const extracted = await extractDocumentText(req.file);

        const result = await ragService.ingestDocument({
            title: req.body?.title,
            department: req.body?.department,
            networkId: req.network.id,
            policy_type: req.body?.policy_type || null,
            version: req.body?.version || null,
            effective_date: req.body?.effective_date || null,
            status: req.body?.status || 'active',
            source_url: req.body?.source_url || null,
            section_title: req.body?.section_title || null,
            source_type: extracted.sourceType,
            source_filename: extracted.sourceFilename,
            content: extracted.content,
            metadata: {
                mime_type: extracted.mimeType,
            },
        });

        res.status(201).json({
            message: 'Policy file ingested successfully.',
            ...result,
        });
    } catch (error) {
        res.status(400).json({
            error: error.message || 'Failed to ingest policy file.',
        });
    }
};

const askPolicyQuestion = async (req, res) => {
    try {
        const result = await ragService.askPolicyQuestion({
            ...(req.body || {}),
            networkId: req.network.id,
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({
            error: error.message || 'Failed to answer policy question.',
        });
    }
};

module.exports = {
    ingestDocument,
    ingestDocumentFile,
    askPolicyQuestion,
};
