const mongoose = require('mongoose');

function asFiniteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a number`);
  return number;
}

function validateComponents(components, totalInternalTarget) {
  if (!Array.isArray(components)) throw new Error('components must be an array');
  const names = new Set();
  const normalized = components.map((component) => {
    const name = String(component.name || '').trim();
    if (!name) throw new Error('Component name is required');
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate component: ${name}`);
    names.add(key);
    const maxMark = asFiniteNumber(component.maxMark, `${name} maxMark`);
    const weightage = asFiniteNumber(component.weightage, `${name} weightage`);
    if (maxMark <= 0) throw new Error(`${name} maxMark must be greater than 0`);
    if (weightage < 0 || weightage > 100) throw new Error(`${name} weightage must be between 0 and 100`);
    return { name, maxMark, weightage };
  });
  const target = asFiniteNumber(totalInternalTarget, 'totalInternalTarget');
  if (target < 0) throw new Error('totalInternalTarget must be at least 0');
  return { components: normalized, totalInternalTarget: target };
}

function validateStudents(students, components) {
  if (!Array.isArray(students)) throw new Error('students must be an array');
  const rolls = new Set();
  const componentMap = new Map((components || []).map((item) => [item.name, item.maxMark]));
  return students.map((student, index) => {
    const rollNo = String(student.rollNo || '').trim();
    const name = String(student.name || '').trim();
    if (!rollNo || !name) throw new Error(`Student ${index + 1} requires rollNo and name`);
    const key = rollNo.toLowerCase();
    if (rolls.has(key)) throw new Error(`Duplicate roll number: ${rollNo}`);
    rolls.add(key);
    const componentMarks = (student.componentMarks || []).map((entry) => {
      const maxMark = componentMap.get(entry.componentName);
      if (maxMark === undefined) throw new Error(`Unknown component: ${entry.componentName}`);
      const mark = asFiniteNumber(entry.mark, `${entry.componentName} mark`);
      if (mark < 0 || mark > maxMark) {
        throw new Error(`${entry.componentName} mark must be between 0 and ${maxMark}`);
      }
      return { componentName: entry.componentName, mark };
    });
    const attendancePercentage = asFiniteNumber(student.attendancePercentage ?? 0, 'attendancePercentage');
    if (attendancePercentage < 0 || attendancePercentage > 100) {
      throw new Error('attendancePercentage must be between 0 and 100');
    }
    return {
      sNo: Number.isInteger(Number(student.sNo)) && Number(student.sNo) > 0 ? Number(student.sNo) : index + 1,
      rollNo,
      name,
      attendancePercentage,
      componentMarks,
    };
  });
}

function validateAttendancePayload(payload, classStudentIds) {
  const date = new Date(payload.date);
  if (!payload.date || Number.isNaN(date.getTime())) throw new Error('A valid attendance date is required');
  if (!['lab', 'theory'].includes(payload.type)) throw new Error('Attendance type must be lab or theory');
  if (!Array.isArray(payload.periods) || payload.periods.length === 0) throw new Error('At least one period is required');
  const periods = payload.periods.map((value) => asFiniteNumber(value, 'period'));
  if (periods.some((period) => !Number.isInteger(period) || period < 1 || period > 8)) {
    throw new Error('Periods must be integers between 1 and 8');
  }
  if (new Set(periods).size !== periods.length) throw new Error('Periods must be unique');

  const absentStudentIds = new Set();
  const absentees = (payload.absentees || []).map((absentee) => {
    const studentId = String(absentee.studentId || '');
    if (!mongoose.isObjectIdOrHexString(studentId)) throw new Error('Absentee studentId is invalid');
    if (!classStudentIds.has(studentId)) throw new Error('Absentee student does not belong to this class');
    if (absentStudentIds.has(studentId)) throw new Error('Each absentee must appear only once');
    absentStudentIds.add(studentId);
    const periodsAbsent = (absentee.periodsAbsent || []).map((value) => asFiniteNumber(value, 'periodsAbsent'));
    if (periodsAbsent.some((period) => !periods.includes(period))) {
      throw new Error('Absent periods must be included in conducted periods');
    }
    if (new Set(periodsAbsent).size !== periodsAbsent.length) throw new Error('Absent periods must be unique');
    return { studentId, periodsAbsent };
  });
  return { date, type: payload.type, periods, absentees };
}

module.exports = { validateAttendancePayload, validateComponents, validateStudents };
