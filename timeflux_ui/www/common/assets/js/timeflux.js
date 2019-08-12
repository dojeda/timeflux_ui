/**
 * @file Timeflux JavaScript API
 * @author Pierre Clisson <pierre@clisson.net>
 */

'use strict';


////////////////////////////////////////////////////////////////////////////////////////
// Scheduler
////////////////////////////////////////////////////////////////////////////////////////

/**
 * Schedule a repeating stimulus
 *
 * The following events are provided: tick, start, stop.
 *
 * Tested in Chrome (MacOS). Other browsers may have imprecise timestamps. More tests
 * will soon be available. Avoid switching tabs when a stim is running.
 *
 * @mixes Dispatcher
 */
class Scheduler {

  /**
   * Initialize the scheduler
   *
   * @param {number} [rate] - rate in Hz (0 means each frame)
   * @param {number} [duration] - duration in ms
   */
  constructor(rate = 0, duration = 1000) {
    this._frame = this._frame.bind(this);
    this.rate = rate;
    this.duration = duration;
  }

  /**
   * Start the scheduler
   */
  start() {
    this.interval = this.rate == 0 ? 0 : (1 / this.rate) * 1000;
    this.loop = true;
    this.trigger('start', this.rate, this.duration);
    this.time_start = performance.now();
    this.time_tick = 0;
    this.time_frame = 0;
    requestAnimationFrame(this._frame);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    this.loop = false;
    this.trigger('stop');
  }

  /**
   * Render
   */
  _frame(time_scheduled) {
    let time_called = performance.now();
    let ellapsed = time_called - this.time_tick;
    let fps = 1000 / (time_called - this.time_frame);
    this.time_frame = time_called;
    if ((time_called - this.time_start) >= this.duration) {
        this.stop();
    }
    if (ellapsed >= this.interval) {
        this.time_tick = time_called;
        this.trigger('tick', time_scheduled, time_called, ellapsed, fps);
    }
    if (this.loop) {
        requestAnimationFrame(this._frame);
    }
  }

}


////////////////////////////////////////////////////////////////////////////////////////
// I/O
////////////////////////////////////////////////////////////////////////////////////////

/**
 * Bidirectional communication
 *
 * This class provides methods for subscribing to and unsubsribing from streams,
 * publish streams, and send low-level WebSocket messages.
 *
 * The following events are provided: connect, disconnect, error, message, streams,
 * <command>, <stream>. Callbacks can be registered with the on() method.
 *
 * @mixes Dispatcher
 */
class IO {

  /**
   * Initialize the connection
   *
   * @param {string} [uri=ws://localhost:8000] - WebSocket server address
   */
  constructor(uri = 'ws://localhost:8000') {
    this.uri = uri;
    this._connect = this._connect.bind(this);
    this._on_open = this._on_open.bind(this);
    this._on_close = this._on_close.bind(this);
    this._on_error = this._on_error.bind(this);
    this._on_message = this._on_message.bind(this);
    this.buffer = {};
    this.subscriptions = [];
    this.uuid = uuidv4();
    this._connect();
  }

  /**
   * Send a message
   *
   * This is a rather low-level method. Use at your own risk.
   * Currently accepted commands: subscribe, unsubscribe, publish.
   *
   * @param {string} command
   * @param {*} payload
   * @returns {boolean}
   */
  send(command, payload) {
    try {
      let message = JSON.stringify({command: command, payload: payload});
      this.socket.send(message);
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Subscribe to a topic
   *
   * @param {string} topic
   * @returns {boolean}
   */
  subscribe(topic) {
    if (this.subscriptions.includes(topic) === false) {
        this.subscriptions.push(topic);
        return this.send('subscribe', topic);
    }
    return false;
  }

  /**
   * Unsubscribe from a topic
   *
   * @param {string} topic
   * @returns {boolean}
   */
  unsubscribe(topic) {
    let index = this.subscriptions.indexOf(topic);
    if (index !== -1) {
        this.subscriptions.splice(index, 1);
        return this.send('unsubscribe', topic);
    }
    return false;
  }

  /**
   * Publish
   *
   * @param {string} topic
   * @param {Object} [meta]
   * @returns {boolean}
   */
  publish(topic, meta = null) {
    if (topic in this.buffer) {
      let payload = {
        name: topic,
        data: this.buffer[topic],
        meta: meta
      };
      if (this.send('publish', payload)) {
        delete this.buffer[topic];
        return true;
      }
    }
    return false;
  }

  /**
   * Commit
   *
   * @param {string} topic
   * @param {Object} data
   */
  commit(topic, data) {
    // Since ES6, index strings are stored in creation order. Because the buffer will
    // later be converted to a JSON string, and JSON.stringify() uses strings as
    // indices, it makes sense to cast the number (float or integer) returned by
    // microtime() to a string. Hence, the insertion order is guaranteed.
    // @see https://www.ecma-international.org/ecma-262/6.0/#sec-ordinary-object-internal-methods-and-internal-slots-ownpropertykeys
    // @see https://esdiscuss.org/topic/nailing-object-property-order
    // @see https://2ality.com/2015/10/property-traversal-order-es6.html#traversing-the-own-keys-of-an-object
    // @see https://www.stefanjudis.com/today-i-learned/property-order-is-predictable-in-javascript-objects-since-es2015/
    if (!(topic in this.buffer)) this.buffer[topic] = {};
    this.buffer[topic][microtime().toString()] = data;
  }

  /**
   * Syntaxic sugar to send an event
   *
   * @param {string} label
   * @param {Object} [data]
   * @returns {boolean}
   */
  event(label, data = null) {
    if (data) data = JSON.stringify(data);
    this.commit('events', { label: label, data: data });
    return this.publish('events');
  }

  /**
   * Sync to master clock
   */
  sync() {
    // TODO
  }

  _connect() {
    if (this.socket === undefined || this.socket.readyState === WebSocket.CLOSED) {
      this.socket = new WebSocket(this.uri + '/ws?uuid=' + this.uuid);
      this.socket.onopen = this._on_open;
      this.socket.onclose = this._on_close.bind(this);
      this.socket.onerror = this._on_error;
      this.socket.onmessage = this._on_message;
    }
  }

  _disconnect() {
    this.socket.close();
  }

  _on_open(event) {
    this.trigger('connect');
    for (let topic of this.subscriptions) {
      this.send('subscribe', topic);
    }
  }

  _on_close(event) {
    window.setTimeout(this._connect, 1000);
    this.trigger('disconnect');
  }

  _on_error(event) {
    this.trigger('error');
  }

  _on_message(event) {
    let message = JSON.parse(event.data);
    if (message['command'] === 'stream') {
        this.trigger(
          message['payload']['name'],
          message['payload']['data'],
          message['payload']['meta']
        );
    }
    this.trigger(message['command'], message['payload']);
    this.trigger('message', message);
  }

}


////////////////////////////////////////////////////////////////////////////////////////
// Event dispatcher
////////////////////////////////////////////////////////////////////////////////////////

/**
 * This provides methods used for event handling. Not meant to be used directly.
 *
 * @mixin
 */
let Dispatcher = {

  /**
   * Subscribe
   */
  on(eventName, handler) {
    if (!this._eventHandlers) this._eventHandlers = {};
    if (!this._eventHandlers[eventName]) {
      this._eventHandlers[eventName] = [];
    }
    this._eventHandlers[eventName].push(handler);
  },

  /**
   * Unsubscribe
   */
  off(eventName, handler) {
    let handlers = this._eventHandlers && this._eventHandlers[eventName];
    if (!handlers) return;
    for (let i = 0; i < handlers.length; i++) {
      if (handlers[i] === handler) {
        handlers.splice(i--, 1);
      }
    }
  },

  /**
   * Dispatch events
   */
  trigger(eventName, ...args) {
    if (!this._eventHandlers || !this._eventHandlers[eventName]) {
      return;
    }
    this._eventHandlers[eventName].forEach(handler => handler.apply(this, args));
  }

};


////////////////////////////////////////////////////////////////////////////////////////
// Mixins
////////////////////////////////////////////////////////////////////////////////////////

// Add event dispatching
Object.assign(Scheduler.prototype, Dispatcher);
Object.assign(IO.prototype, Dispatcher);


////////////////////////////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////////////////////////////

/**
 * RFC-compliant UUID
 * @see {@link https://www.ietf.org/rfc/rfc4122.txt}
 */
function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  )
}

/**
 * Same as Date.now(), but with microsecond precision
 */
function microtime() {
  return performance.now() + performance.timing.navigationStart
}

/**
 * This function runs a callback at next screen refresh
 *
 * @param {asapCallback}
 * @returns {Promise}
 */
function asap(callback) {
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      callback(resolve, reject)
    });
  });
}

/**
 * This callback is displayed as part of asap function.
 *
 * @callback asapCallback
 *
 * @param {resolve} - the resolve callback
 * @param {reject} - the reject callback
 */