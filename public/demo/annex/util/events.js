import * as self from "./events";

var handlers = {};

export function on(name, handler) {
  handlers[name] = handler;
}

export function log(message) {
  self.on("log", function () {});
  if (handlers.log) handlers.log(message);
}
