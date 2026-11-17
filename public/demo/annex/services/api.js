import { settings } from "../config/settings";
import { pad } from "../util/strings";

export function fetchUsers() {
  var stamp = pad(new Date().getMonth() + 1, 2);
  return fetch(settings.baseUrl + "/users?month=" + stamp).then(function (response) {
    return response.json();
  });
}
