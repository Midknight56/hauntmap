import { buildCell } from "./cell";

export function buildRow(user) {
  var row = document.createElement("tr");
  row.appendChild(buildCell(user.name));
  return row;
}
