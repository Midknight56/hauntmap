import { buildRow } from "./row";

export function buildTable(users) {
  var table = document.createElement("table");
  users.forEach(function (user) {
    table.appendChild(buildRow(user));
  });
  return table;
}

export function countRows(table) {
  return table.rows.length;
}
