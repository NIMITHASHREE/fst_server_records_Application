const mongoose = require('mongoose');

const componentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  maxMark: { type: Number, required: true, min: 0 },
  weightage: { type: Number, required: true, min: 0 },
}, { _id: true });

const classSchema = new mongoose.Schema({
  facultyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Faculty',
    required: true,
  },
  semesterNumber: {
    type: Number,
    required: [true, 'Semester number is required'],
    min: 1,
    max: 8,
  },
  academicYear: {
    type: String,
    required: [true, 'Academic year is required'],
    trim: true,
  },
  session: {
    type: String,
    required: [true, 'Session is required'],
    enum: ['Jul - Dec', 'Jan - Jun'],
  },
  courseCode: {
    type: String,
    required: [true, 'Course code is required'],
    trim: true,
    uppercase: true,
  },
  courseName: {
    type: String,
    required: [true, 'Course name is required'],
    trim: true,
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
  },
  courseType: {
    type: String,
    enum: ['LIT', 'T'],
    required: [true, 'Course type is required (LIT or T)'],
  },
  components: [componentSchema],
  totalInternalTarget: {
    type: Number,
    default: 0,
    min: 0,
  },
  studentsUploaded: {
    type: Boolean,
    default: false,
  },
  pdfFile: {
    type: String,
    default: null,
  },
}, { timestamps: true });

module.exports = mongoose.model('Class', classSchema);
