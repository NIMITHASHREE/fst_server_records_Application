const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true,
  },
  sNo: {
    type: Number,
    required: true,
  },
  rollNo: {
    type: String,
    required: [true, 'Roll number is required'],
    trim: true,
  },
  name: {
    type: String,
    required: [true, 'Student name is required'],
    trim: true,
  },
  attendancePercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  componentMarks: [{
    componentName: { type: String, required: true },
    mark: { type: Number, default: 0 },
  }],
  totalInternalMarks: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

// Index for efficient queries
studentSchema.index({ classId: 1, sNo: 1 });

module.exports = mongoose.model('Student', studentSchema);
