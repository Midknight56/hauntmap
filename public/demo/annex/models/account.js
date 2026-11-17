import { User } from "./user";

export function Account(owner) {
  this.owner = owner;
  this.kind = "basic";
}

Account.prototype.isOwnedBy = function (user) {
  return user instanceof User && user === this.owner;
};
