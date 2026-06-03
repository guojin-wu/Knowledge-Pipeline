const path = require('path');

function requireDep(name) {
  try {
    return require(name);
  } catch (error) {
    return require(path.join(__dirname, '../../backend/node_modules', name));
  }
}

module.exports = requireDep;
