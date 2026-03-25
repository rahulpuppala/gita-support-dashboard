const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const FAQ = require('../models/FAQ');
const ContextDocument = require('../models/ContextDocument');
const { extractKeywords } = require('../utils/textProcessor');
const logger = require('../utils/logger');

const KB_DIR = path.join(__dirname, '../../knowledge-base');

async function extractTextFromDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

function parseNumberedFaq(text, sourceFile) {
  const pairs = [];
  // Match numbered entries like: 1) Question?\n\nAnswer text
  const sections = text.split(/\n\s*\d+\)\s*/).filter((s) => s.trim().length > 0);

  // Also try to capture the numbers for a regex-based split that preserves question lines
  const matches = text.matchAll(/(\d+)\)\s*([^\n]+)\n([\s\S]*?)(?=\n\s*\d+\)|$)/g);

  for (const match of matches) {
    const question = match[2].trim();
    const answer = match[3].trim();
    if (question && answer) {
      pairs.push({
        question,
        answer,
        keywords: extractKeywords(question + ' ' + answer).slice(0, 15).join(','),
        source_file: sourceFile,
      });
    }
  }

  return pairs;
}

function parseQAPairs(text, sourceFile) {
  // First try numbered FAQ format (1) Question? \n Answer)
  const numberedPairs = parseNumberedFaq(text, sourceFile);
  if (numberedPairs.length > 0) return numberedPairs;

  const pairs = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  let currentQuestion = null;
  let currentAnswer = [];

  for (const line of lines) {
    const isQuestion =
      line.endsWith('?') ||
      /^(q|question)\s*[:\d]/i.test(line) ||
      /^(what|how|when|where|why|who|can|do|does|is|are|will|should)\s/i.test(line);

    if (isQuestion) {
      if (currentQuestion && currentAnswer.length > 0) {
        pairs.push({
          question: currentQuestion,
          answer: currentAnswer.join(' ').trim(),
          keywords: extractKeywords(currentQuestion).join(','),
          source_file: sourceFile,
        });
        currentAnswer = [];
      }
      currentQuestion = line;
    } else if (currentQuestion) {
      currentAnswer.push(line);
    }
  }

  if (currentQuestion && currentAnswer.length > 0) {
    pairs.push({
      question: currentQuestion,
      answer: currentAnswer.join(' ').trim(),
      keywords: extractKeywords(currentQuestion).join(','),
      source_file: sourceFile,
    });
  }

  // If no Q&A pairs found, treat sections as knowledge chunks
  if (pairs.length === 0 && text.trim().length > 0) {
    const chunks = text.split(/\n\s*\n/).filter((c) => c.trim().length > 20);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      const firstLine = chunk.split('\n')[0].trim();
      pairs.push({
        question: firstLine.length > 10 ? firstLine : `Knowledge section ${i + 1}`,
        answer: chunk,
        keywords: extractKeywords(chunk).slice(0, 10).join(','),
        source_file: sourceFile,
      });
    }
  }

  return pairs;
}

async function processFile(filePath) {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  logger.info(`Processing ${ext} file: ${fileName}`);

  try {
    let text;
    if (ext === '.docx') {
      text = await extractTextFromDocx(filePath);
    } else {
      text = fs.readFileSync(filePath, 'utf-8');
    }
    const pairs = parseQAPairs(text, fileName);

    // Remove old entries from this file
    FAQ.deleteBySourceFile(fileName);

    let count = 0;
    for (const pair of pairs) {
      FAQ.create({
        question: pair.question,
        answer: pair.answer,
        keywords: pair.keywords,
        category: 'Knowledge Base',
        source_file: pair.source_file,
      });
      count++;
    }

    logger.info(`Extracted ${count} FAQ entries from ${fileName}`);
    return count;
  } catch (err) {
    logger.error(`Failed to process ${fileName}: ${err.message}`);
    throw err;
  }
}

async function processContextFile(filePath) {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  logger.info(`Processing context file: ${fileName}`);

  try {
    let text;
    if (ext === '.docx') {
      text = await extractTextFromDocx(filePath);
    } else {
      text = fs.readFileSync(filePath, 'utf-8');
    }

    // Remove old entries from this file
    ContextDocument.deleteBySourceFile(fileName);

    const trimmed = text.trim();
    const firstLine = trimmed.split('\n')[0].trim();
    const title = firstLine.length > 5 ? firstLine.substring(0, 200) : fileName;

    ContextDocument.create({
      title,
      content: trimmed,
      doc_type: 'general',
      source_file: fileName,
    });

    logger.info(`Stored context document from ${fileName}`);
    return 1;
  } catch (err) {
    logger.error(`Failed to process context file ${fileName}: ${err.message}`);
    throw err;
  }
}

const SUPPORTED_EXTENSIONS = ['.docx', '.txt'];

async function loadAllFiles() {
  if (!fs.existsSync(KB_DIR)) {
    fs.mkdirSync(KB_DIR, { recursive: true });
    logger.info('Created knowledge-base directory');
    return 0;
  }

  const files = fs.readdirSync(KB_DIR).filter((f) =>
    SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase())
  );
  let totalEntries = 0;

  for (const file of files) {
    const count = await processFile(path.join(KB_DIR, file));
    totalEntries += count;
  }

  logger.info(`Knowledge base loaded: ${totalEntries} entries from ${files.length} files`);
  return totalEntries;
}

function getKnowledgeContext() {
  const faqs = FAQ.findActive();
  if (faqs.length === 0) return 'No FAQ entries available.';

  return faqs
    .map((f, i) => `FAQ ${i + 1}:\nQ: ${f.question}\nA: ${f.answer}`)
    .join('\n\n');
}

function getReferenceContext() {
  const docs = ContextDocument.findActive();
  if (docs.length === 0) return '';

  return docs
    .map((d, i) => `[${i + 1}] ${d.title}\n${d.content}`)
    .join('\n\n');
}

module.exports = { processFile, processContextFile, loadAllFiles, getKnowledgeContext, getReferenceContext, parseQAPairs, SUPPORTED_EXTENSIONS };
