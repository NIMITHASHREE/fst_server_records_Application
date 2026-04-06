const jwt = require('jsonwebtoken');
const Faculty = require('../models/Faculty');

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided, access denied' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const faculty = await Faculty.findById(decoded.id).select('-password');
    if (!faculty) {
      return res.status(401).json({ message: 'Token is invalid' });
    }

    req.faculty = faculty;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token is invalid or expired' });
  }
};

module.exports = auth;
