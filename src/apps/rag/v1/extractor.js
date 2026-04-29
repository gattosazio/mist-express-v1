const path = require('path');
const { PDFParase } = require('pdf-parse');
const mammoth = require('mammoth');

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
const SUPPORTED_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'application/octet-stream',
]);

const normalizeExtractedText = (text = '') =>
    String(text || '')
        .replace(/\r/g, '')
        .replace(/\t/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const getExtension = (filename = '') => path.extname(filename).toLowerCase();

const assertSupportedFile = (file) => {
    if (!file) {
        throw new Error('Policy file is required.');
    }

    const extension = getExtension(file.originalname || '');
    const mimeType = String(file.mimetype || '').toLowerCase();

    if (!SUPPORTED_EXTENSIONS.has(extension) && !SUPPORTED_MIME_TYPES.has(mimeType)) {
        throw new Error('Unsupported file type. Only PDF, DOCX, TXT, and MD are allowed.');
    }
};

const { PDFParse } = require('pdf-parse');

const extractPdfText = async (buffer) => {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return normalizeExtractedText(result.text);
    } finally {
        await parser.destroy();
    }
};

const extractDocxText = async (buffer) => {
    const result = await mammoth.extractRawText({ buffer });
    return normalizeExtractedText(result.value);
};

const extractPlainText = async (buffer) => {
    return normalizeExtractedText(buffer.toString('utf8'));
};

const inferSourceType = (filename = '') => {
    const extension = getExtension(filename);

    if (extension === '.pdf') return 'pdf';
    if (extension === '.docx') return 'docx';
    if (extension === '.md') return 'markdown';
    return 'text';
};

const extractDocumentText = async (file) => {
    assertSupportedFile(file);

    const extension = getExtension(file.originalname || '');
    let content = '';

    if (extension === '.pdf') {
        content = await extractPdfText(file.buffer);
    } else if (extension === '.docx') {
        content = await extractDocxText(file.buffer);
    } else {
        content = await extractPlainText(file.buffer);
    }

    if (!content) {
        throw new Error('The uploaded file did not contain extractable text.');
    }

    return {
        content,
        sourceType: inferSourceType(file.originalname),
        sourceFilename: file.originalname || null,
        mimeType: file.mimetype || null,
    };
};

module.exports = {
    extractDocumentText,
};
