import { User } from "./user";

var current = null;

export function signIn(name) {
  current = new User(name);
  return current;
}

export function signOut() {
  current = null;
}
