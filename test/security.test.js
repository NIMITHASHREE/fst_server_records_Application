const test = require('node:test');
const assert = require('node:assert/strict');

const validateObjectIds = require('../middleware/validateObjectId');
const {
  validateAttendancePayload,
  validateComponents,
  validateStudents,
} = require('../utils/validation');

test('object id middleware rejects malformed route identifiers', () => {
  const req = { params: { classId: 'not-an-object-id' } };
  let response;
  const res = {
    status(status) {
      response = { status };
      return this;
    },
    json(body) {
      response.body = body;
      return this;
    },
  };
  let calledNext = false;
  validateObjectIds('classId')(req, res, () => { calledNext = true; });
  assert.equal(calledNext, false);
  assert.deepEqual(response, {
    status: 400,
    body: { message: 'Invalid classId' },
  });
});

test('student validation rejects duplicates and invalid marks', () => {
  const duplicateStudents = [
    { rollNo: 'FST001', name: 'One' },
    { rollNo: 'fst001', name: 'Two' },
  ];
  assert.throws(() => validateStudents(duplicateStudents, []), /Duplicate roll number/);
  assert.throws(
    () => validateStudents([
      { rollNo: 'FST001', name: 'One', componentMarks: [{ componentName: 'Quiz', mark: 11 }] },
    ], [{ name: 'Quiz', maxMark: 10 }]),
    /between 0 and 10/,
  );
});

test('component validation rejects duplicate names and invalid weights', () => {
  assert.throws(
    () => validateComponents([
      { name: 'Quiz', maxMark: 10, weightage: 50 },
      { name: 'quiz', maxMark: 20, weightage: 50 },
    ], 40),
    /Duplicate component/,
  );
  assert.throws(
    () => validateComponents([{ name: 'Quiz', maxMark: 10, weightage: 101 }], 40),
    /weightage/,
  );
});

test('attendance validation enforces dates, periods, and class-owned students', () => {
  const studentId = '507f1f77bcf86cd799439011';
  assert.throws(
    () => validateAttendancePayload({ date: 'invalid', type: 'theory', periods: [1] }, new Set()),
    /date/,
  );
  assert.throws(
    () => validateAttendancePayload({
      date: '2026-07-08',
      type: 'theory',
      periods: [1, 1],
      absentees: [],
    }, new Set()),
    /unique/,
  );
  assert.throws(
    () => validateAttendancePayload({
      date: '2026-07-08',
      type: 'theory',
      periods: [1],
      absentees: [{ studentId, periodsAbsent: [2] }],
    }, new Set([studentId])),
    /conducted periods/,
  );
  assert.throws(
    () => validateAttendancePayload({
      date: '2026-07-08',
      type: 'theory',
      periods: [1],
      absentees: [{ studentId, periodsAbsent: [1] }],
    }, new Set()),
    /does not belong/,
  );
});
