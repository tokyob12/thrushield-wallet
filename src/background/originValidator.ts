import { isOriginAuthorized } from "./storage";

export function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function assertAuthorizedOrigin(origin: string): Promise<void> {
  if (!isValidOrigin(origin)) {
    throw Object.assign(new Error("Invalid origin"), {
      code: "UNAUTHORIZED_ORIGIN" as const,
    });
  }

  const authorized = await isOriginAuthorized(origin);
  if (!authorized) {
    throw Object.assign(new Error("Origin not in authorized dApps whitelist"), {
      code: "UNAUTHORIZED_ORIGIN" as const,
    });
  }
}
