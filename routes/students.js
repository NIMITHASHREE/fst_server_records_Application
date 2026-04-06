const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const Class = require('../models/Class');
const Student = require('../models/Student');
const auth = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// All routes here are protected
router.use(auth);

// ---- Multer config for Excel uploads ----
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'temp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const uploadExcel = multer({
  storage: excelStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ---- Multer config for PDF uploads ----
const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'pdfs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${req.params.classId}-${Date.now()}.pdf`);
  },
});

const uploadPdf = multer({
  storage: pdfStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Helper: verify class ownership
async function getClassForFaculty(classId, facultyId) {
  const classDoc = await Class.findOne({ _id: classId, facultyId });
  return classDoc;
}

// Helper: safely extract plain text from an ExcelJS cell value.
// ExcelJS can return strings, numbers, Date objects, or RichText objects
// ({ richText: [{text: '...'}] }) depending on how the cell was formatted in Excel.
// Using String() on a RichText object gives "[object Object]", breaking header detection.
function getCellText(cell) {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  // RichText: { richText: [{ text: '...' }, ...] }
  if (val.richText && Array.isArray(val.richText)) {
    return val.richText.map(r => r.text || '').join('').trim();
  }
  // Shared string or formula result with a .text property
  if (typeof val.text === 'string') return val.text.trim();
  // Fallback
  return String(val).trim();
}

// Helper: calculate total internal marks for a student
function calculateTotal(student, classDoc) {
  if (!classDoc.components || classDoc.components.length === 0 || !classDoc.totalInternalTarget) {
    return 0;
  }
  let total = 0;
  for (const comp of classDoc.components) {
    const studentComp = student.componentMarks.find(cm => cm.componentName === comp.name);
    const mark = studentComp ? studentComp.mark : 0;
    if (comp.maxMark > 0) {
      total += (mark / comp.maxMark) * (comp.weightage / 100) * classDoc.totalInternalTarget;
    }
  }
  return Math.round(total * 100) / 100; // round to 2 decimal places
}

// =====================================================
// POST /api/classes/:classId/upload-students
// Upload an Excel file to populate the student roster
// Expected columns: S.No, Roll No, Name, Attendance (optional)
// If Attendance column is absent, defaults to 0 for all students
// =====================================================
router.post('/upload-students', uploadExcel.single('file'), async (req, res) => {
  let tempFilePath = null;
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });
    if (classDoc.status === 'archived') return res.status(400).json({ message: 'Cannot modify an archived class' });

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    tempFilePath = req.file.path;

    // Parse the Excel file
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(tempFilePath);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      return res.status(400).json({ message: 'Excel file has no worksheets' });
    }

    // ── Step 1: collect all rows as raw arrays ──────────────────────────────
    const allRows = [];
    worksheet.eachRow((row) => {
      const maxCol = Math.max(row.cellCount, 10);
      const cells = [];
      for (let c = 1; c <= maxCol; c++) {
        cells.push(getCellText(row.getCell(c)));
      }
      allRows.push(cells);
    });

    // ── Step 2: find the header row ───────────────────────────────────────
    // Look for the first row that contains both a roll-number-like header
    // AND a name-like header (case-insensitive, trims whitespace).
    let headerRowIdx = -1;
    let colMap = {}; // { sno, rollNo, name, attendance } → 0-based col index

    for (let r = 0; r < allRows.length; r++) {
      const row = allRows[r].map(v => v.toLowerCase().replace(/\s+/g, ''));
      const hasRoll = row.some(v => v.includes('rollno') || v.includes('regno') || v === 'roll' || v === 'rollnumber');
      const hasName = row.some(v => v === 'name' || v.includes('studentname'));
      if (hasRoll && hasName) {
        headerRowIdx = r;
        row.forEach((v, i) => {
          if (v.includes('s.no') || v === 'sno' || v === 'sno.' || v === 's.no.' || v === 'serialno') colMap.sno = i;
          if (v.includes('rollno') || v.includes('regno') || v === 'roll' || v === 'rollnumber') colMap.rollNo = i;
          if (v === 'name' || v.includes('studentname')) colMap.name = i;
          if (v.includes('attendance') || v === 'att' || v === 'att%' || v.includes('attendancepercent')) colMap.attendance = i;
        });
        break;
      }
    }

    // Debug log — visible in your server console
    console.log('[upload-students] headerRowIdx:', headerRowIdx, '| colMap:', colMap);
    console.log('[upload-students] header row raw values:', headerRowIdx >= 0 ? allRows[headerRowIdx] : 'NOT FOUND');

    if (headerRowIdx === -1 || colMap.rollNo === undefined || colMap.name === undefined) {
      return res.status(400).json({
        message: 'Could not find a valid header row. Expected columns: Roll No, Name (S.No and Attendance are optional).',
        debug: { headerRowIdx, colMap, firstThreeRows: allRows.slice(0, 3) },
      });
    }

    // ── Step 3: parse data rows ───────────────────────────────────────────
    const students = [];
    const rollNumbers = new Set();

    for (let r = headerRowIdx + 1; r < allRows.length; r++) {
      const cells = allRows[r];
      const rollNo = cells[colMap.rollNo] || '';
      const name = cells[colMap.name] || '';

      if (!rollNo || !name) continue;      // blank row
      if (rollNumbers.has(rollNo)) continue; // duplicate
      rollNumbers.add(rollNo);

      const sNo = colMap.sno !== undefined ? (Number(cells[colMap.sno]) || students.length + 1) : students.length + 1;

      let attendancePercentage = 0;
      if (colMap.attendance !== undefined) {
        const raw = cells[colMap.attendance];
        attendancePercentage = Math.min(100, Math.max(0, parseFloat(raw) || 0));
      }

      students.push({
        classId: classDoc._id,
        sNo,
        rollNo,
        name,
        attendancePercentage,
        componentMarks: [],
        totalInternalMarks: 0,
      });
    }

    if (students.length === 0) {
      return res.status(400).json({
        message: 'No valid student data found in the Excel file. Expected columns: S.No, Roll No, Name (Attendance is optional)',
      });
    }

    // Remove any previously uploaded students for this class
    await Student.deleteMany({ classId: classDoc._id });

    // Insert all parsed students
    await Student.insertMany(students);

    // Mark students as uploaded
    classDoc.studentsUploaded = true;
    await classDoc.save();

    // Clean up temp file
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

    const insertedStudents = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });

    res.status(201).json({
      message: `${students.length} students uploaded successfully`,
      attendanceImported: colMap.attendance !== undefined,
      students: insertedStudents,
    });
  } catch (error) {
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    console.error('Upload students error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// =====================================================
// GET /api/classes/:classId/students
// Get all students for a class
// =====================================================
router.get('/students', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const students = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// PUT /api/classes/:classId/students
// Bulk update students (marks, attendance, add/delete)
// Expects: { students: [...studentObjects] }
// =====================================================
router.put('/students', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });
    if (classDoc.status === 'archived') return res.status(400).json({ message: 'Cannot modify an archived class' });

    const { students } = req.body;
    if (!students || !Array.isArray(students)) {
      return res.status(400).json({ message: 'Students array is required' });
    }

    // Delete existing students for this class
    await Student.deleteMany({ classId: classDoc._id });

    // Re-insert with updated data
    const studentDocs = students.map((s, index) => ({
      classId: classDoc._id,
      sNo: s.sNo || index + 1,
      rollNo: s.rollNo,
      name: s.name,
      attendancePercentage: Math.min(100, Math.max(0, Number(s.attendancePercentage) || 0)),
      componentMarks: (s.componentMarks || []).map(cm => ({
        componentName: cm.componentName,
        mark: Number(cm.mark) || 0,
      })),
      totalInternalMarks: 0, // will be recalculated below
    }));

    // Calculate totals
    for (const s of studentDocs) {
      s.totalInternalMarks = calculateTotal(s, classDoc);
    }

    if (studentDocs.length > 0) {
      await Student.insertMany(studentDocs);
    }

    // Update studentsUploaded flag
    classDoc.studentsUploaded = studentDocs.length > 0;
    await classDoc.save();

    const saved = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });
    res.json(saved);
  } catch (error) {
    console.error('Update students error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// PUT /api/classes/:classId/components
// Update component configuration
// Expects: { components: [...], totalInternalTarget: Number }
// =====================================================
router.put('/components', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });
    if (classDoc.status === 'archived') return res.status(400).json({ message: 'Cannot modify an archived class' });

    const { components, totalInternalTarget } = req.body;

    if (components !== undefined) {
      classDoc.components = components.map(c => ({
        name: c.name,
        maxMark: Number(c.maxMark) || 0,
        weightage: Number(c.weightage) || 0,
      }));
    }

    if (totalInternalTarget !== undefined) {
      classDoc.totalInternalTarget = Number(totalInternalTarget) || 0;
    }

    await classDoc.save();

    // Recalculate totals for all students in this class
    const students = await Student.find({ classId: classDoc._id });
    for (const student of students) {
      student.totalInternalMarks = calculateTotal(student, classDoc);
      await student.save();
    }

    res.json(classDoc);
  } catch (error) {
    console.error('Update components error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// GET /api/classes/:classId/download-excel
// Generate and download an Excel file with all class data
// =====================================================
router.get('/download-excel', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    const students = await Student.find({ classId: classDoc._id }).sort({ sNo: 1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${classDoc.courseCode} - ${classDoc.courseName}`);

    // Build header columns
    const columns = [
      { header: 'S.No', key: 'sNo', width: 8 },
      { header: 'Roll No', key: 'rollNo', width: 18 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Attendance %', key: 'attendance', width: 15 },
    ];

    // Add component columns
    const componentNames = (classDoc.components || []).map(c => c.name);
    for (const compName of componentNames) {
      columns.push({ header: compName, key: compName, width: 16 });
    }

    columns.push({ header: 'Total Internal Marks', key: 'total', width: 20 });

    worksheet.columns = columns;

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' },
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    // Add student rows
    for (const student of students) {
      const rowData = {
        sNo: student.sNo,
        rollNo: student.rollNo,
        name: student.name,
        attendance: student.attendancePercentage,
        total: student.totalInternalMarks,
      };

      // Add component marks
      for (const compName of componentNames) {
        const comp = student.componentMarks.find(cm => cm.componentName === compName);
        rowData[compName] = comp ? comp.mark : 0;
      }

      const row = worksheet.addRow(rowData);

      // Highlight attendance < 75% in red
      if (student.attendancePercentage < 75) {
        const attendanceCell = row.getCell('attendance');
        attendanceCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFEF2F2' },
        };
        attendanceCell.font = { color: { argb: 'FFDC2626' }, bold: true };
      }
    }

    // Add component info as a separate section below
    if (classDoc.components && classDoc.components.length > 0) {
      worksheet.addRow([]);
      worksheet.addRow(['Component Configuration']);
      worksheet.addRow(['Component', 'Max Mark', 'Weightage (%)', 'Total Internal Target: ' + classDoc.totalInternalTarget]);
      for (const comp of classDoc.components) {
        worksheet.addRow([comp.name, comp.maxMark, comp.weightage]);
      }
    }

    // Set response headers
    const filename = `${classDoc.courseCode}_${classDoc.courseName}_Semester${classDoc.semesterNumber}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Download excel error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// =====================================================
// POST /api/classes/:classId/upload-pdf
// Upload a PDF file for the class
// =====================================================
router.post('/upload-pdf', uploadPdf.single('file'), async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // If there was a previous PDF, delete it
    if (classDoc.pdfFile && fs.existsSync(classDoc.pdfFile)) {
      fs.unlinkSync(classDoc.pdfFile);
    }

    classDoc.pdfFile = req.file.path;
    await classDoc.save();

    res.json({ message: 'PDF uploaded successfully', pdfFile: classDoc.pdfFile });
  } catch (error) {
    console.error('Upload PDF error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// =====================================================
// GET /api/classes/:classId/download-pdf
// Download the stored PDF
// =====================================================
router.get('/download-pdf', async (req, res) => {
  try {
    const classDoc = await getClassForFaculty(req.params.classId, req.faculty._id);
    if (!classDoc) return res.status(404).json({ message: 'Class not found' });

    if (!classDoc.pdfFile || !fs.existsSync(classDoc.pdfFile)) {
      return res.status(404).json({ message: 'No PDF file found' });
    }

    const filename = `${classDoc.courseCode}_${classDoc.courseName}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/pdf');

    const fileStream = fs.createReadStream(classDoc.pdfFile);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Download PDF error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;