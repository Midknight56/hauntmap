import { formatLabel } from "@/lib/format";

export function buildField(name) {
  var input = document.createElement("input");
  input.name = name;
  input.placeholder = formatLabel(name);
  return input;
}
