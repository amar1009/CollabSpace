export type User = { id: string; name: string; email: string };
export type Role = "OWNER" | "EDITOR" | "VIEWER";
export type Document = {
  id: string;
  title: string;
  ownerId: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; name: string };
};
export type Version = { id: string; createdAt: string; watermark: string };
