import { Account } from "./account";

export function User(name) {
  this.name = name;
  this.account = new Account(this);
}

User.prototype.label = function () {
  return this.name + " (" + this.account.kind + ")";
};
