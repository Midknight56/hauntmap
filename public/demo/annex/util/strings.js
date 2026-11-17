export function pad(value, width) {
  var text = String(value);
  while (text.length < width) text = "0" + text;
  return text;
}
