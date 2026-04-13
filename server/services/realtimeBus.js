const { EventEmitter } = require('events');

const realtimeBus = new EventEmitter();
realtimeBus.setMaxListeners(200);

function publishSse(eventName, payload = {}) {
    realtimeBus.emit('sse:event', { event: eventName, payload });
}

module.exports = {
    realtimeBus,
    publishSse,
};
