const express = require('express');
const jwt = require('jsonwebtoken');
const Faculty = require('../models/Faculty');
const auth = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    // Find faculty by username
    const faculty = await Faculty.findOne({ username: username.toLowerCase() });
    if (!faculty) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Check password
    const isMatch = await faculty.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    res.json({
      _id: faculty._id,
      name: faculty.name,
      username: faculty.username,
      designation: faculty.designation,
      token: generateToken(faculty._id),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auth/me — get current faculty profile
router.get('/me', auth, async (req, res) => {
  res.json(req.faculty);
});

module.exports = router;
