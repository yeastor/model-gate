export function fail(code, status = 400) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  throw e;
}
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
