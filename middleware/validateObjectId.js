const mongoose = require('mongoose');

function validateObjectIds(...names) {
  return (req, res, next) => {
    for (const name of names) {
      if (req.params[name] && !mongoose.isObjectIdOrHexString(req.params[name])) {
        return res.status(400).json({ message: `Invalid ${name}` });
      }
    }
    return next();
  };
}

module.exports = validateObjectIds;
