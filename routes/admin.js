const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const Faculty = require('../models/Faculty');
const Class = require('../models/Class');
const Student = require('../models/Student');
const AttendanceSession = require('../models/AttendanceSession');
const adminAuth = require('../middleware/adminAuth');
const validateObjectIds = require('../middleware/validateObjectId');

const router = express.Router();

function equalSecret(value, expected) {
  const valueDigest = crypto.createHash('sha256').update(String(value)).digest();
  const expectedDigest = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(valueDigest, expectedDigest);
}

// Generate admin JWT
const generateAdminToken = () => {
  return jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

// =====================================================
// POST /api/admin/login
// Hardcoded admin credentials from .env
// =====================================================
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  const adminUser = process.env.ADMIN_USERNAME;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!equalSecret(username, adminUser) || !equalSecret(password, adminPass)) {
    return res.status(401).json({ message: 'Invalid admin credentials' });
  }

  res.json({
    role: 'admin',
    username: adminUser,
    token: generateAdminToken(),
  });
});

// =====================================================
// All routes below require admin auth
// =====================================================
router.use(adminAuth);

// =====================================================
// POST /api/admin/faculty — Create a faculty member
// =====================================================
router.post('/faculty', async (req, res) => {
  try {
    const { name, username, password, designation } = req.body;

    if (!name || !username || !password || !designation) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const existing = await Faculty.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    const faculty = await Faculty.create({ name, username, password, designation });

    res.status(201).json({
      _id: faculty._id,
      name: faculty.name,
      username: faculty.username,
      designation: faculty.designation,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: messages.join(', ') });
    }
    console.error('Create faculty error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/admin/faculties — List all faculties
// =====================================================
router.get('/faculties', async (req, res) => {
  try {
    const faculties = await Faculty.find().select('-password').sort({ name: 1 });

    // For each faculty, get their class count
    const results = await Promise.all(faculties.map(async (f) => {
      const classCount = await Class.countDocuments({ facultyId: f._id });
      return {
        ...f.toObject(),
        classCount,
      };
    }));

    res.json(results);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/admin/faculties/:id/classes — Faculty's classes
// =====================================================
router.get('/faculties/:id/classes', validateObjectIds('id'), async (req, res) => {
  try {
    const faculty = await Faculty.findById(req.params.id).select('-password');
    if (!faculty) return res.status(404).json({ message: 'Faculty not found' });

    const classes = await Class.find({ facultyId: faculty._id }).sort({ createdAt: -1 });

    res.json({ faculty, classes });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/admin/classes/:id — Full class detail (read-only)
// =====================================================
router.get('/classes/:id', validateObjectIds('id'), async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const students = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });
    const faculty = await Faculty.findById(classDoc.facultyId).select('-password');

    res.json({ classData: classDoc, students, faculty });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/admin/classes/:id/attendance/summary
// =====================================================
router.get('/classes/:id/attendance/summary', validateObjectIds('id'), async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const students = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });
    const sessions = await AttendanceSession.find({ classId: classDoc._id });

    // Reuse the summary calculation logic
    const labSessions = sessions.filter(s => s.type === 'lab');
    const theorySessions = sessions.filter(s => s.type === 'theory');

    const computeForType = (typeSessions, student) => {
      let conducted = 0;
      let absent = 0;
      for (const session of typeSessions) {
        conducted += session.periods.length;
        const absentee = session.absentees.find(
          a => a.studentId.toString() === student._id.toString()
        );
        if (absentee) absent += absentee.periodsAbsent.length;
      }
      const present = conducted - absent;
      const percentage = conducted > 0 ? Math.round((present / conducted) * 10000) / 100 : 0;
      return { conducted, present, absent, percentage };
    };

    const summary = students.map(student => {
      const lab = computeForType(labSessions, student);
      const theory = computeForType(theorySessions, student);
      const combinedConducted = lab.conducted + theory.conducted;
      const combinedPresent = lab.present + theory.present;
      const combinedPercentage = combinedConducted > 0
        ? Math.round((combinedPresent / combinedConducted) * 10000) / 100
        : 0;

      return {
        studentId: student._id,
        sNo: student.sNo,
        rollNo: student.rollNo,
        name: student.name,
        lab, theory,
        combined: { conducted: combinedConducted, present: combinedPresent, absent: lab.absent + theory.absent, percentage: combinedPercentage },
      };
    });

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/admin/classes/:id/download-excel
// Download class marks sheet (same as faculty download)
// =====================================================
router.get('/classes/:id/download-excel', validateObjectIds('id'), async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const students = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${classDoc.courseCode}`);

    const columns = [
      { header: 'S.No', key: 'sNo', width: 8 },
      { header: 'Roll No', key: 'rollNo', width: 18 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Attendance %', key: 'attendance', width: 15 },
    ];

    const componentNames = (classDoc.components || []).map(c => c.name);
    for (const compName of componentNames) {
      columns.push({ header: compName, key: compName, width: 16 });
    }
    columns.push({ header: 'Total Internal Marks', key: 'total', width: 20 });
    worksheet.columns = columns;

    const headerRow = worksheet.getRow(1);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

    for (const student of students) {
      const rowData = {
        sNo: student.sNo,
        rollNo: student.rollNo,
        name: student.name,
        attendance: student.attendancePercentage,
        total: student.totalInternalMarks,
      };
      for (const compName of componentNames) {
        const comp = student.componentMarks.find(cm => cm.componentName === compName);
        rowData[compName] = comp ? comp.mark : 0;
      }
      worksheet.addRow(rowData);
    }

    const filename = `${classDoc.courseCode}_Marks.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/admin/classes/:id/attendance/download-excel
// Download attendance sheet
// =====================================================
router.get('/classes/:id/attendance/download-excel', validateObjectIds('id'), async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const students = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });
    const downloadType = req.query.type || 'combined';

    let filter = { classId: classDoc._id };
    if (downloadType === 'lab') filter.type = 'lab';
    else if (downloadType === 'theory') filter.type = 'theory';

    const sessions = await AttendanceSession.find(filter).sort({ date: 1 });

    const workbook = new ExcelJS.Workbook();
    const label = downloadType === 'combined' ? 'Combined' : downloadType === 'lab' ? 'Lab' : 'Theory';
    const worksheet = workbook.addWorksheet(`${label} Attendance`);

    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').value = `${classDoc.courseCode} — ${classDoc.courseName}`;
    worksheet.getCell('A1').font = { bold: true, size: 12 };

    worksheet.mergeCells('A2:F2');
    worksheet.getCell('A2').value = `${label} Attendance`;

    const headerRow = ['S.No', 'Roll No', 'Name'];
    for (const session of sessions) {
      const d = new Date(session.date);
      headerRow.push(`${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, 'Periods', 'Hours');
    }
    headerRow.push('Total Present', 'Total Conducted', '%');
    const row3 = worksheet.addRow(headerRow);
    row3.font = { bold: true };

    for (const student of students) {
      const rowData = [student.sNo, student.rollNo, student.name];
      let totalConducted = 0;
      let totalAbsent = 0;

      for (const session of sessions) {
        totalConducted += session.periods.length;
        const absentee = session.absentees.find(a => a.studentId.toString() === student._id.toString());
        const periodsAbsent = absentee ? absentee.periodsAbsent.length : 0;
        totalAbsent += periodsAbsent;
        const periodsPresent = session.periods.filter(p => !absentee || !absentee.periodsAbsent.includes(p));
        rowData.push(periodsPresent.join(',') || '-', periodsPresent.length, '');
      }

      const totalPresent = totalConducted - totalAbsent;
      const percentage = totalConducted > 0 ? Math.round((totalPresent / totalConducted) * 10000) / 100 : 0;
      rowData.push(totalPresent, totalConducted, percentage);
      worksheet.addRow(rowData);
    }

    const filename = `${classDoc.courseCode}_${label}_Attendance.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
