const ragService = require('./service');
const { extractDocumentText } = require('./extractor');
const { logDocumentIngest, logPolicyInteraction } = require('./audit');

const tryAudit = async (operation) => {
    try {
        await operation();
    } catch (error) {
        console.error('[RAG AUDIT ERROR]', error.message);
    }
};

const ingestDocument = async (req, res) => {
    try {
        const result = await ragService.ingestDocument({
            ...(req.body || {}),
            networkId: req.network.id,
        });

        await tryAudit(() =>
            logDocumentIngest({
                userId: req.user.id,
                authUserId: req.auth.supabase_user_id,
                networkId: req.network.id,
                query: `ingest_document:${result.documentId}`,
                response: 'Document ingested successfully.',
                metadata: {
                    action: 'document_ingested',
                    documentId: result.documentId,
                    title: req.body?.title || null,
                    department: req.body?.department || null,
                    sourceType: result.sourceType,
                    sourceFilename: result.sourceFilename || null,
                },
            })
        );

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

        await tryAudit(() =>
            logDocumentIngest({
                userId: req.user.id,
                authUserId: req.auth.supabase_user_id,
                networkId: req.network.id,
                query: `ingest_document_file:${result.documentId}`,
                response: 'Policy file ingested successfully.',
                metadata: {
                    action: 'document_file_ingested',
                    documentId: result.documentId,
                    title: req.body?.title || null,
                    department: req.body?.department || null,
                    sourceType: result.sourceType,
                    sourceFilename: result.sourceFilename || null,
                },
            })
        );

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

        await tryAudit(() =>
            logPolicyInteraction({
                userId: req.user.id,
                authUserId: req.auth.supabase_user_id,
                networkId: req.network.id,
                query: req.body?.question || '',
                response: result.answer || 'No answer returned.',
                confidence: result.confidence || 'low',
                escalationNeeded: Boolean(result.escalationNeeded),
                citations: result.citations || [],
                retrievedChunks: result.retrievedChunks || [],
                policyType: result.resolvedPolicyType || null,
                metadata: {
                    action: 'policy_question_answered',
                    resolvedDepartment: result.resolvedDepartment || null,
                    retrievalMethod: result.retrievalMethod || null,
                    needsClarification: Boolean(result.needsClarification),
                },
            })
        );

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
