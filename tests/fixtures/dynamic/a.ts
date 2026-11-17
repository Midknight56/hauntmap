export async function load(name: string) {
  await import("./b");
  return import(name);
}