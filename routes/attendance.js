const express = require('express');
const ExcelJS = require('exceljs');
const Class = require('../models/Class');
const Student = require('../models/Student');
const AttendanceSession = require('../models/AttendanceSession');
const auth = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.use(auth);

// Helper: verify class ownership
async function getClassForFaculty(classId, facultyId) {
  return await Class.findOne({ _id: classId, facultyId });
}

// =====================================================
// POST /api/classes/:classId/attendance
// Create a new attendance session
// Body: { date, type, periods, absentees: [{ studentId, periodsAbsent }] }
// =====================================================
router.post('/', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });
    if (classDoc.status === 'archived') return res.status(400).json({ message: 'Cannot modify an archived class' });

    const { date, type, periods, absentees } = req.body;

    if (!date || !type || !periods || !Array.isArray(periods) || periods.length === 0) {
      return res.status(400).json({ message: 'Date, type, and periods are required' });
    }

    // For T courses, only theory is allowed
    if (classDoc.courseType === 'T' && type !== 'theory') {
      return res.status(400).json({ message: 'Theory-only course. Cannot mark lab attendance.' });
    }

    const session = await AttendanceSession.create({
      classId: classDoc._id,
      date: new Date(date),
      type,
      periods: periods.map(Number),
      absentees: (absentees || []).map(a => ({
        studentId: a.studentId,
        periodsAbsent: (a.periodsAbsent || []).map(Number),
      })),
    });

    res.status(201).json(session);
  } catch (error) {
    console.error('Create attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/classes/:classId/attendance
// List all sessions, with optional ?type=lab|theory filter
// =====================================================
router.get('/', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const filter = { classId: classDoc._id };
    if (req.query.type) filter.type = req.query.type;

    const sessions = await AttendanceSession.find(filter).sort({ date: 1, type: 1 });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/classes/:classId/attendance/summary
// Calculated attendance % per student
// =====================================================
router.get('/summary', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const students = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });
    const sessions = await AttendanceSession.find({ classId: classDoc._id });

    const summary = buildAttendanceSummary(students, sessions);
    res.json(summary);
  } catch (error) {
    console.error('Attendance summary error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/classes/:classId/attendance/download-excel
// Download attendance as xlsx. Query: ?type=lab|theory|combined
// IMPORTANT: This must be BEFORE /:sessionId route
// =====================================================
router.get('/download-excel', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
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

    // Row 1: Class info
    worksheet.mergeCells('A1:F1');
    worksheet.getCell('A1').value = `${classDoc.courseCode} — ${classDoc.courseName} | Semester ${classDoc.semesterNumber} | ${classDoc.academicYear}`;
    worksheet.getCell('A1').font = { bold: true, size: 12 };

    // Row 2: Attendance type
    worksheet.mergeCells('A2:F2');
    worksheet.getCell('A2').value = `${label} Attendance`;
    worksheet.getCell('A2').font = { bold: true, size: 11, color: { argb: 'FF4F46E5' } };

    // Row 3: Column headers
    const headerRow = [];
    headerRow.push('S.No', 'Roll No', 'Name');
    for (const session of sessions) {
      const d = new Date(session.date);
      const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      headerRow.push(dateStr, 'Periods', 'Hours');
    }
    headerRow.push('Total Present', 'Total Conducted', '%');
    const row3 = worksheet.addRow(headerRow);
    row3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    row3.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };

    worksheet.getColumn(1).width = 6;
    worksheet.getColumn(2).width = 16;
    worksheet.getColumn(3).width = 24;

    // Row 4+: Student data
    for (const student of students) {
      const rowData = [student.sNo, student.rollNo, student.name];
      let totalConducted = 0;
      let totalAbsent = 0;

      for (const session of sessions) {
        const periodCount = session.periods.length;
        totalConducted += periodCount;

        const absentee = session.absentees.find(
          a => a.studentId.toString() === student._id.toString()
        );
        const periodsAbsent = absentee ? absentee.periodsAbsent.length : 0;
        totalAbsent += periodsAbsent;

        const periodsPresent = session.periods.filter(p => {
          return !absentee || !absentee.periodsAbsent.includes(p);
        });
        const hoursPresent = periodsPresent.length;

        rowData.push(
          periodsPresent.join(',') || '-',
          hoursPresent,
          ''
        );
      }

      const totalPresent = totalConducted - totalAbsent;
      const percentage = totalConducted > 0 ? Math.round((totalPresent / totalConducted) * 10000) / 100 : 0;
      rowData.push(totalPresent, totalConducted, percentage);

      const dataRow = worksheet.addRow(rowData);

      if (percentage < 75) {
        const lastCell = dataRow.getCell(rowData.length);
        lastCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
        lastCell.font = { color: { argb: 'FFDC2626' }, bold: true };
      }
    }

    const filename = `${classDoc.courseCode}_${label}_Attendance.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Download attendance excel error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/classes/:classId/attendance/:sessionId
// Get one session
// =====================================================
router.get('/:sessionId', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const session = await AttendanceSession.findOne({
      _id: req.params.sessionId,
      classId: classDoc._id,
    });
    if (!session) return res.status(404).json({ message: 'Session not found' });

    res.json(session);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// PUT /api/classes/:classId/attendance/:sessionId
// Edit/correct an existing session
// =====================================================
router.put('/:sessionId', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });
    if (classDoc.status === 'archived') return res.status(400).json({ message: 'Cannot modify an archived class' });

    const session = await AttendanceSession.findOne({
      _id: req.params.sessionId,
      classId: classDoc._id,
    });
    if (!session) return res.status(404).json({ message: 'Session not found' });

    const { date, type, periods, absentees } = req.body;

    if (date) session.date = new Date(date);
    if (type) session.type = type;
    if (periods && Array.isArray(periods)) session.periods = periods.map(Number);
    if (absentees !== undefined) {
      session.absentees = (absentees || []).map(a => ({
        studentId: a.studentId,
        periodsAbsent: (a.periodsAbsent || []).map(Number),
      }));
    }

    await session.save();
    res.json(session);
  } catch (error) {
    console.error('Update attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// DELETE /api/classes/:classId/attendance/:sessionId
// Delete a session
// =====================================================
router.delete('/:sessionId', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const session = await AttendanceSession.findOneAndDelete({
      _id: req.params.sessionId,
      classId: classDoc._id,
    });
    if (!session) return res.status(404).json({ message: 'Session not found' });

    res.json({ message: 'Attendance session deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// (download-excel route moved above /:sessionId for correct Express matching)

// =====================================================
// Helper: build attendance summary
// Returns per-student lab/theory/combined stats
// =====================================================
function buildAttendanceSummary(students, sessions) {
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

  return students.map(student => {
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
      lab,
      theory,
      combined: {
        conducted: combinedConducted,
        present: combinedPresent,
        absent: lab.absent + theory.absent,
        percentage: combinedPercentage,
      },
    };
  });
}

module.exports = router;
