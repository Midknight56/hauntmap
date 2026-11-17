import { User } from "./models/index";
import { render } from "./views/render";
import { fetchUsers } from "./services/api";
import { log } from "./util/events";
import "./legacy/polyfills";

var users = [];

export function start(root) {
  log("start");
  fetchUsers().then(function (list) {
    users = list.map(function (item) {
      return new User(item.name);
    });
    render(root, users);
  });
}
