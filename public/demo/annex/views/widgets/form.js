import { buildField } from "./field";
import { byId } from "../../util/dom";

export function buildForm() {
  var form = document.createElement("form");
  form.appendChild(buildField("name"));
  form.id = byId("main") ? "form-main" : "form";
  return form;
}
