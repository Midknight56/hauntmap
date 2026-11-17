import { ENV } from "~/config/env";

export var settings = {
  baseUrl: ENV === "production" ? "https://shop.example.test/api" : "http://localhost:3000/api",
};
