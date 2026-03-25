const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const FAQ = require('../../models/FAQ');
const { processFile, loadAllFiles, SUPPORTED_EXTENSIONS } = require('../../services/knowledgeBase');
const { authenticateToken } = require('../../middleware/auth');
const logger = require('../../utils/logger');

const KB_DIR = path.join(__dirname, '../../../knowledge-base');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
    cb(null, KB_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return cb(new Error('Only .docx and .txt files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(authenticateToken);

router.get('/faqs', (req, res) => {
  try {
    const { search, category } = req.query;
    let faqs;
    if (search) {
      faqs = FAQ.search(search);
    } else if (category) {
      faqs = FAQ.findByCategory(category);
    } else {
      faqs = FAQ.findAll();
    }
    res.json({ faqs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/faqs', (req, res) => {
  try {
    const { question, answer, keywords, category } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ error: 'Question and answer are required' });
    }
    const faq = FAQ.create({ question, answer, keywords, category, source_file: 'manual' });
    logger.info(`FAQ created manually: ${question.substring(0, 50)}`);
    res.status(201).json({ faq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/faqs/:id', (req, res) => {
  try {
    const { question, answer, keywords, category, confidence_threshold } = req.body;
    const faq = FAQ.update(parseInt(req.params.id), { question, answer, keywords, category, confidence_threshold });
    res.json({ faq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/faqs/:id', (req, res) => {
  try {
    FAQ.delete(parseInt(req.params.id));
    res.json({ message: 'FAQ deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/faqs/:id/toggle', (req, res) => {
  try {
    const faq = FAQ.toggleActive(parseInt(req.params.id));
    res.json({ faq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const count = await processFile(req.file.path);
    logger.info(`Uploaded and processed ${req.file.originalname}: ${count} FAQ entries`);
    res.json({ message: `Processed ${count} FAQ entries from ${req.file.originalname}`, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reload', async (req, res) => {
  try {
    const count = await loadAllFiles();
    res.json({ message: `Reloaded knowledge base: ${count} total entries`, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/files', (req, res) => {
  try {
    if (!fs.existsSync(KB_DIR)) return res.json({ files: [] });
    const files = fs.readdirSync(KB_DIR)
      .filter((f) => SUPPORTED_EXTENSIONS.includes(path.extname(f).toLowerCase()))
      .map((f) => {
        const stats = fs.statSync(path.join(KB_DIR, f));
        return { name: f, size: stats.size, modified: stats.mtime };
      });
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/files/:filename', (req, res) => {
  try {
    const filePath = path.join(KB_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    FAQ.deleteBySourceFile(req.params.filename);
    logger.info(`Deleted knowledge base file: ${req.params.filename}`);
    res.json({ message: 'File and associated FAQs deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
