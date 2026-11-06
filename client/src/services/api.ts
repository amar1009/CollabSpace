export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "Request failed. Please try again." }));
    throw new ApiError(response.status, body.error);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";
