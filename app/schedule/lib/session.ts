export const ACTIVE_USER_STORAGE_KEY = "todolist:active-user-id";

export function readActiveUserId(): number | null {
  if (typeof window === "undefined") return null;
  const value = Number(window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
