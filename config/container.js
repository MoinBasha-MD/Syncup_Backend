const awilix = require('awilix');
const userService = require('../services/userService');
const statusService = require('../services/statusService');

// Create the container
const container = awilix.createContainer({
  injectionMode: awilix.InjectionMode.PROXY
});

// Register services
container.register({
  userService: awilix.asValue(userService),
  statusService: awilix.asValue(statusService)
});

module.exports = container;
