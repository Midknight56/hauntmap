import { settings } from "../config/settings";

export function save(key, value) {
  localStorage.setItem(settings.baseUrl + key, JSON.stringify(value));
}
