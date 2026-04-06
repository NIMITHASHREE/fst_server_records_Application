const express = require('express');
const fs = require('fs');
const Class = require('../models/Class');
const Student = require('../models/Student');
const AttendanceSession = require('../models/AttendanceSession');
const auth = require('../middleware/auth');

const router = express.Router();

// All routes here are protected
router.use(auth);

// GET /api/classes — list classes for the logged-in faculty
// Query: ?status=active or ?status=archived (optional)
router.get('/', async (req, res) => {
  try {
    const filter = { facultyId: req.faculty._id };

    if (req.query.status) {
      filter.status = req.query.status;
    }

    const classes = await Class.find(filter).sort({ createdAt: -1 });
    res.json(classes);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/classes — create a new class
router.post('/', async (req, res) => {
  try {
    const { semesterNumber, academicYear, session, courseCode, courseName, courseType } = req.body;

    if (!semesterNumber || !academicYear || !session || !courseCode || !courseName || !courseType) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const newClass = await Class.create({
      facultyId: req.faculty._id,
      semesterNumber,
      academicYear,
      session,
      courseCode,
      courseName,
      courseType,
    });

    res.status(201).json(newClass);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/classes/:id — get a single class
router.get('/:id', async (req, res) => {
  try {
    const classDoc = await Class.findOne({
      _id: req.params.id,
      facultyId: req.faculty._id,
    });

    if (!classDoc) {
      return res.status(404).json({ message: 'Class not found' });
    }

    res.json(classDoc);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/classes/:id — update class details
router.put('/:id', async (req, res) => {
  try {
    const { semesterNumber, academicYear, session, courseCode, courseName } = req.body;

    const classDoc = await Class.findOne({
      _id: req.params.id,
      facultyId: req.faculty._id,
    });

    if (!classDoc) {
      return res.status(404).json({ message: 'Class not found' });
    }

    if (classDoc.status === 'archived') {
      return res.status(400).json({ message: 'Cannot edit an archived class' });
    }

    // Update fields if provided
    if (semesterNumber !== undefined) classDoc.semesterNumber = semesterNumber;
    if (academicYear !== undefined) classDoc.academicYear = academicYear;
    if (session !== undefined) classDoc.session = session;
    if (courseCode !== undefined) classDoc.courseCode = courseCode;
    if (courseName !== undefined) classDoc.courseName = courseName;

    await classDoc.save();
    res.json(classDoc);
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/classes/:id/archive — archive a class
router.put('/:id/archive', async (req, res) => {
  try {
    const classDoc = await Class.findOne({
      _id: req.params.id,
      facultyId: req.faculty._id,
    });

    if (!classDoc) {
      return res.status(404).json({ message: 'Class not found' });
    }

    if (classDoc.status === 'archived') {
      return res.status(400).json({ message: 'Class is already archived' });
    }

    classDoc.status = 'archived';
    await classDoc.save();
    res.json(classDoc);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/classes/:id — delete a class and all associated data
router.delete('/:id', async (req, res) => {
  try {
    const classDoc = await Class.findOne({
      _id: req.params.id,
      facultyId: req.faculty._id,
    });

    if (!classDoc) {
      return res.status(404).json({ message: 'Class not found' });
    }

    // Delete all students in this class
    await Student.deleteMany({ classId: classDoc._id });

    // Delete all attendance sessions for this class
    await AttendanceSession.deleteMany({ classId: classDoc._id });

    // Delete stored PDF if it exists
    if (classDoc.pdfFile && fs.existsSync(classDoc.pdfFile)) {
      fs.unlinkSync(classDoc.pdfFile);
    }

    await Class.findByIdAndDelete(classDoc._id);

    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
