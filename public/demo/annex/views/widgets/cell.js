import { countRows } from "./table";

export function buildCell(text) {
  var cell = document.createElement("td");
  cell.textContent = text;
  cell.title = "rows: " + countRows(cell.parentNode || document.createElement("table"));
  return cell;
}
