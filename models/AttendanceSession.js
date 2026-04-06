const mongoose = require('mongoose');

const absenteeSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true,
  },
  periodsAbsent: [{
    type: Number,
    min: 1,
    max: 8,
  }],
}, { _id: false });

const attendanceSessionSchema = new mongoose.Schema({
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
  },
  type: {
    type: String,
    enum: ['lab', 'theory'],
    required: [true, 'Attendance type is required'],
  },
  periods: [{
    type: Number,
    min: 1,
    max: 8,
  }],
  absentees: [absenteeSchema],
}, { timestamps: true });

// Index for efficient queries
attendanceSessionSchema.index({ classId: 1, date: 1, type: 1 });

module.exports = mongoose.model('AttendanceSession', attendanceSessionSchema);
