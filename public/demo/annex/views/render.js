import { buildTable } from "./widgets/table";
import { buildForm } from "./widgets/form";
import { byId } from "../util/dom";

export function render(rootId, users) {
  var root = byId(rootId);
  root.appendChild(buildTable(users));
  root.appendChild(buildForm());
}
