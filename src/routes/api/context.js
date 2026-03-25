const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ContextDocument = require('../../models/ContextDocument');
const { processContextFile, SUPPORTED_EXTENSIONS } = require('../../services/knowledgeBase');
const { authenticateToken } = require('../../middleware/auth');
const logger = require('../../utils/logger');

const KB_DIR = path.join(__dirname, '../../../knowledge-base');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
    cb(null, KB_DIR);
  },
  filename: (req, file, cb) => {
    // Prefix context files to distinguish from FAQ files
    const name = file.originalname.startsWith('context-')
      ? file.originalname
      : `context-${file.originalname}`;
    cb(null, name);
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

// List all context documents
router.get('/', (req, res) => {
  try {
    const { search, type } = req.query;
    let docs;
    if (search) {
      docs = ContextDocument.search(search);
    } else if (type) {
      docs = ContextDocument.findByType(type);
    } else {
      docs = ContextDocument.findAll();
    }
    res.json({ documents: docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a context document manually (text, link, notes)
router.post('/', (req, res) => {
  try {
    const { title, content, doc_type } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }
    const doc = ContextDocument.create({ title, content, doc_type: doc_type || 'general', source_file: 'manual' });
    logger.info(`Context document created: ${title.substring(0, 50)}`);
    res.status(201).json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a context document
router.put('/:id', (req, res) => {
  try {
    const { title, content, doc_type } = req.body;
    const doc = ContextDocument.update(parseInt(req.params.id), { title, content, doc_type });
    res.json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a context document
router.delete('/:id', (req, res) => {
  try {
    ContextDocument.delete(parseInt(req.params.id));
    res.json({ message: 'Context document deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle active status
router.patch('/:id/toggle', (req, res) => {
  try {
    const doc = ContextDocument.toggleActive(parseInt(req.params.id));
    res.json({ document: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload a context file (non-FAQ document)
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const count = await processContextFile(req.file.path);
    logger.info(`Uploaded context file ${req.file.originalname}: ${count} sections`);
    res.json({ message: `Processed ${count} context sections from ${req.file.originalname}`, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
